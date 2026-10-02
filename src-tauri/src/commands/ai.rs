use serde::{Deserialize, Serialize};
use std::io::Read;
use std::net::TcpStream;
use std::time::Duration;

#[derive(Serialize)]
pub struct LlmStatus {
    pub configured: bool,
    pub provider: String,
}

const PROVIDERS: &[(&str, &str)] = &[
    ("LLM_API_KEY", "通用 LLM"),
    ("OPENAI_API_KEY", "OpenAI"),
    ("ANTHROPIC_API_KEY", "Anthropic"),
    ("DEEPSEEK_API_KEY", "DeepSeek"),
    ("MOONSHOT_API_KEY", "Moonshot"),
    ("DASHSCOPE_API_KEY", "阿里百炼"),
];

/// 智能层状态检测：探测环境变量中是否已配置 LLM API Key。
/// 前端据此显示/隐藏智能能力入口，未配置时不渲染以免报错。
#[tauri::command]
pub fn llm_status() -> LlmStatus {
    for (var, provider) in PROVIDERS {
        if let Ok(val) = std::env::var(var) {
            if !val.trim().is_empty() {
                return LlmStatus {
                    configured: true,
                    provider: provider.to_string(),
                };
            }
        }
    }
    LlmStatus {
        configured: false,
        provider: "未配置".to_string(),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatArgs {
    pub url: String,
    pub api_key: String,
    pub body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatResult {
    pub ok: bool,
    pub status: u16,
    pub body: String,
}

fn port_open(port: u16) -> bool {
    std::net::ToSocketAddrs::to_socket_addrs(&format!("127.0.0.1:{port}"))
        .map(|mut addrs| {
            addrs.any(|a| TcpStream::connect_timeout(&a, Duration::from_secs(1)).is_ok())
        })
        .unwrap_or(false)
}

/// 读取注册表系统代理（ProxyServer 形如 127.0.0.1:7890 或 http=...;https=...）
fn registry_proxy() -> Option<String> {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        .ok()?;
    let enabled: u32 = key.get_value("ProxyEnable").unwrap_or(0);
    if enabled == 0 {
        return None;
    }
    let server: String = key.get_value("ProxyServer").unwrap_or_default();
    let host = server
        .split(';')
        .find(|p| p.starts_with("https=") || p.starts_with("http="))
        .map(|p| p.split('=').nth(1).unwrap_or(""))
        .unwrap_or(server.as_str())
        .trim()
        .to_string();
    if host.is_empty() {
        None
    } else if host.contains("://") {
        Some(host)
    } else {
        Some(format!("http://{host}"))
    }
}

fn try_post(url: &str, api_key: &str, body: &str, proxy: Option<&str>) -> Result<LlmChatResult, String> {
    let mut agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(120));
    if let Some(p) = proxy {
        match ureq::Proxy::new(p) {
            Ok(px) => agent = agent.proxy(px),
            Err(_) => return Err(format!("代理地址无效：{p}")),
        }
    }
    let mut req = agent
        .build()
        .post(url)
        .set("Content-Type", "application/json");
    if !api_key.is_empty() {
        req = req.set("Authorization", &format!("Bearer {api_key}"));
    }
    match req.send_string(body) {
        Ok(resp) => {
            let status = resp.status();
            let mut text = String::new();
            resp.into_reader().take(4 * 1024 * 1024).read_to_string(&mut text).map_err(|e| format!("读取响应失败：{e}"))?;
            Ok(LlmChatResult { ok: status == 200, status, body: text })
        }
        Err(ureq::Error::Status(code, resp)) => {
            let mut text = String::new();
            let _ = resp.into_reader().take(64 * 1024).read_to_string(&mut text);
            Ok(LlmChatResult { ok: false, status: code, body: text })
        }
        Err(e) => Err(format!("网络请求失败：{e}")),
    }
}

/// LLM 对话代理命令：WebView 内 fetch 直连 LLM API 会被 CORS 拦截，
/// 改由 Rust 侧原生 HTTP 转发（支持 OpenAI 兼容 chat/completions）。
/// 直连失败时按 注册表系统代理 → 本地 7890 → 7897 顺序重试（Clash 常用端口）。
#[tauri::command]
pub async fn llm_chat(args: LlmChatArgs) -> Result<LlmChatResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // 先直连；仅网络层错误才尝试代理，HTTP 4xx/5xx 是服务端应答，不重试
        match try_post(&args.url, &args.api_key, &args.body, None) {
            Ok(r) => Ok(r),
            Err(direct_err) => {
                let mut candidates: Vec<String> = Vec::new();
                if let Some(p) = registry_proxy() {
                    candidates.push(p);
                }
                for port in [7890u16, 7897] {
                    if port_open(port) {
                        candidates.push(format!("http://127.0.0.1:{port}"));
                    }
                }
                for p in &candidates {
                    if let Ok(r) = try_post(&args.url, &args.api_key, &args.body, Some(p)) {
                        return Ok(r);
                    }
                }
                Err(direct_err)
            }
        }
    })
    .await
    .map_err(|e| format!("{e}"))?
}
