use serde::Serialize;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

#[derive(Serialize)]
pub struct ProxyInfo {
    pub enabled: bool,
    pub server: String,
    pub auto_config: String,
    pub port7890_ok: bool,
}

fn probe_port(host: &str, port: u16) -> bool {
    let addr = format!("{host}:{port}");
    if let Ok(addrs) = addr.to_socket_addrs() {
        for a in addrs {
            if TcpStream::connect_timeout(&a, Duration::from_secs(3)).is_ok() {
                return true;
            }
        }
    }
    false
}

/// 代理状态检测命令：读取 Windows 系统代理开关与服务器配置，
/// 并探测 127.0.0.1:7890（常见 Clash 端口）是否在线。
/// 代理挂掉时多 Agent 会集体超时，用于运维页「代理状态检测」。
#[tauri::command]
pub fn proxy_detect() -> ProxyInfo {
    let script = r#"
$p = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -Name ProxyEnable,ProxyServer,AutoConfigURL -ErrorAction SilentlyContinue
[PSCustomObject]@{
  Enabled = [bool]$p.ProxyEnable
  Server  = [string]$p.ProxyServer
  Auto    = [string]$p.AutoConfigURL
} | ConvertTo-Json -Compress
"#;
    let mut enabled = false;
    let mut server = String::new();
    let mut auto_config = String::new();
    if let Ok(out) = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    {
        let text = String::from_utf8_lossy(&out.stdout);
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(text.trim()) {
            enabled = v["Enabled"].as_bool().unwrap_or(false);
            server = v["Server"].as_str().unwrap_or("").to_string();
            auto_config = v["Auto"].as_str().unwrap_or("").to_string();
        }
    }

    // 常见本地代理端口探测（7890 为主，兼测 7897）
    let port7890_ok = probe_port("127.0.0.1", 7890) || probe_port("127.0.0.1", 7897);

    ProxyInfo {
        enabled,
        server,
        auto_config,
        port7890_ok,
    }
}
