use serde::Serialize;
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

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

fn read_proxy_settings() -> (bool, String, String) {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu.open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings");
    match key {
        Ok(k) => {
            let enabled: u32 = k.get_value("ProxyEnable").unwrap_or(0);
            let server: String = k.get_value("ProxyServer").unwrap_or_default();
            let auto: String = k.get_value("AutoConfigURL").unwrap_or_default();
            (enabled != 0, server, auto)
        }
        Err(_) => (false, String::new(), String::new()),
    }
}

/// 代理状态检测命令：原生读取 Windows 系统代理开关与服务器配置（注册表直读），
/// 并探测 127.0.0.1:7890（常见 Clash 端口）是否在线，不再调用系统命令行工具。
/// 代理挂掉时多 Agent 会集体超时，用于运维页「代理状态检测」。
#[tauri::command]
pub async fn proxy_detect() -> ProxyInfo {
    tauri::async_runtime::spawn_blocking(move || {

        let (enabled, server, auto_config) = read_proxy_settings();
        let port7890_ok = probe_port("127.0.0.1", 7890) || probe_port("127.0.0.1", 7897);
        ProxyInfo {
            enabled,
            server,
            auto_config,
            port7890_ok,
        }

    })
    .await
    .unwrap_or_else(|e| panic!("spawn_blocking 失败: {e}"))
}
