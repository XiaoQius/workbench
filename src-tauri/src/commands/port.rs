use serde::Serialize;
use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
pub struct PortInfo {
    pub proto: String,
    pub port: u16,
    pub state: String,
    pub pid: u32,
    pub process: String,
}

/// 端口占用命令：解析 `netstat -ano`，返回 { proto, port, state, pid, process }。
/// 用于多 Agent 抢 3000 / 5173 等高频事故定位。
#[tauri::command]
pub async fn port_usage() -> Result<Vec<PortInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let out = std::process::Command::new("netstat")
            .args(["-ano"])
            .creation_flags(NO_WINDOW)
            .output()
            .map_err(|e| format!("netstat 调用失败: {e}"))?;

        let text = String::from_utf8_lossy(&out.stdout);
        let mut map: HashMap<u16, (String, String, u32)> = HashMap::new(); // port -> (proto, state, pid)

        for line in text.lines() {
            let line = line.trim();
            if !(line.starts_with("TCP") || line.starts_with("UDP")) {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 5 {
                continue;
            }
            let proto = parts[0].to_string();
            let local = parts[1];
            let port = match local.rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) {
                Some(p) => p,
                None => continue,
            };
            let pid = match parts.last().and_then(|p| p.parse::<u32>().ok()) {
                Some(p) => p,
                None => continue,
            };
            // TCP 第 4 列为状态；UDP 无状态列
            let state = if proto.starts_with("TCP") && parts.len() >= 4 {
                parts[parts.len() - 2].to_string()
            } else {
                String::from("LISTENING")
            };
            if !map.contains_key(&port) {
                map.insert(port, (proto, state, pid));
            }
        }

        if map.is_empty() {
            return Ok(Vec::new());
        }

        // 批量查询进程名（一次 PowerShell 调用）
        let pids: Vec<String> = map.values().map(|v| v.2.to_string()).collect();
        let script = format!(
            "Get-Process -Id {} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName | ConvertTo-Json -Compress",
            pids.join(",")
        );
        let mut names: HashMap<u32, String> = HashMap::new();
        if let Ok(out) = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(NO_WINDOW)
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    let items = match v {
                        serde_json::Value::Array(a) => a,
                        other => vec![other],
                    };
                    for item in items {
                        if let (Some(id), Some(name)) =
                            (item["Id"].as_u64(), item["ProcessName"].as_str())
                        {
                            names.insert(id as u32, name.to_string());
                        }
                    }
                }
            }
        }

        let mut result: Vec<PortInfo> = map
            .into_iter()
            .map(|(port, (proto, state, pid))| PortInfo {
                proto,
                port,
                state,
                pid,
                process: names.get(&pid).cloned().unwrap_or_default(),
            })
            .collect();
        result.sort_by_key(|p| p.port);
        Ok(result)

    })
    .await
    .map_err(|e| format!("{e}"))?
}

#[derive(Serialize)]
pub struct PortProbeResult {
    pub port: u16,
    pub open: bool,
    pub latency_ms: u64,
}

/// 端口在线探活命令：对指定 host 批量探测 TCP 端口（F-LP-03）。
/// 用于启动台 `localhost:xxxx` 条目实时探活（在线绿点 / 离线灰点）。
#[tauri::command]
pub async fn port_probe(host: String, ports: Vec<u16>) -> Vec<PortProbeResult> {
    tauri::async_runtime::spawn_blocking(move || {

        let mut result = Vec::new();
        for port in ports {
            let start = Instant::now();
            let mut open = false;
            if let Ok(addrs) = format!("{host}:{port}").to_socket_addrs() {
                for a in addrs {
                    if TcpStream::connect_timeout(&a, Duration::from_millis(600)).is_ok() {
                        open = true;
                        break;
                    }
                }
            }
            let latency_ms = start.elapsed().as_millis() as u64;
            result.push(PortProbeResult {
                port,
                open,
                latency_ms,
            });
        }
        result

    })
    .await
    .unwrap_or_else(|e| panic!("spawn_blocking 失败: {e}"))
}
