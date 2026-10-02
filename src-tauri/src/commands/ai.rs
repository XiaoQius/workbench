use serde::Serialize;

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
