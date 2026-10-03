use serde::Serialize;
use std::os::windows::process::CommandExt;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
pub struct HealthResult {
    pub target: String,
    pub ok: bool,
    pub latency_ms: u64,
    pub detail: String,
}

fn tcp_probe(host: &str, port: u16) -> Result<(bool, u64), String> {
    let addr = format!("{host}:{port}");
    let addrs = addr
        .to_socket_addrs()
        .map_err(|e| format!("解析地址失败: {e}"))?;
    let start = Instant::now();
    let mut connected = false;
    for a in addrs {
        if TcpStream::connect_timeout(&a, Duration::from_secs(5)).is_ok() {
            connected = true;
            break;
        }
    }
    let latency = start.elapsed().as_millis() as u64;
    Ok((connected, latency))
}

/// 健康探测命令：对 `host:port` 做 TCP 连通探测；对 `http(s)://...` 额外请求状态码。
/// 用于运维页「健康探测」（服务器 /health 或指定 URL 定时探活）。
#[tauri::command]
pub async fn health_check(target: String) -> Result<HealthResult, String> {
    tauri::async_runtime::spawn_blocking(move || {

        if target.starts_with("http://") || target.starts_with("https://") {
            // HTTP(S) 探活：TCP 连接 + PowerShell 取状态码
            //
            // 安全：URL 通过环境变量传给 PowerShell（脚本里读 $env:WB_HEALTH_URL），
            // 绝不拼进 -Command 字符串。原写法把 target 直接 format 进脚本，
            // 一个单引号就能闭合字符串并执行任意命令（PowerShell 命令注入）。
            // 这不只是「用户自己输错」——被同步过来的 servers/domains 等表里
            // 的 URL 同样会流到这里，属于跨设备可触发的路径。
            let start = Instant::now();
            const SCRIPT: &str = "try { $r = Invoke-WebRequest -Uri $env:WB_HEALTH_URL -Method Head -TimeoutSec 5 -UseBasicParsing; Write-Output $r.StatusCode } catch { Write-Output ('ERR:' + $_.Exception.Message) }";
            let out = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", SCRIPT])
                .env("WB_HEALTH_URL", &target)
                .creation_flags(NO_WINDOW)
                .output()
                .map_err(|e| format!("powershell 调用失败: {e}"))?;
            let text = String::from_utf8_lossy(&out.stdout);
            let trimmed = text.trim().to_string();
            let latency = start.elapsed().as_millis() as u64;
            if trimmed.starts_with("ERR:") {
                return Ok(HealthResult {
                    target,
                    ok: false,
                    latency_ms: latency,
                    detail: trimmed,
                });
            }
            let code = trimmed.trim().to_string();
            let ok = code
                .parse::<u16>()
                .map(|c| (200..400).contains(&c))
                .unwrap_or(false);
            return Ok(HealthResult {
                target,
                ok,
                latency_ms: latency,
                detail: format!("HTTP {code}"),
            });
        }

        // host:port 形式
        let (host, port) = match target.rsplit_once(':') {
            Some((h, p)) => (h.to_string(), p.parse::<u16>().map_err(|_| "端口无效".to_string())?),
            None => {
                // 无端口：默认按 443 探测
                (target.clone(), 443)
            }
        };
        let (connected, latency) = tcp_probe(&host, port)?;
        Ok(HealthResult {
            target,
            ok: connected,
            latency_ms: latency,
            detail: if connected {
                "TCP 连通".to_string()
            } else {
                "连接超时或拒绝".to_string()
            },
        })

    })
    .await
    .map_err(|e| format!("{e}"))?
}
