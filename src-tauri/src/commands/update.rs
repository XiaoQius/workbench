use serde::Serialize;

#[derive(Serialize)]
pub struct UpdateInfo {
    pub current: String,
    pub latest: Option<String>,
    pub has_update: bool,
    pub release_url: Option<String>,
}

fn parse_version(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches('v')
        .split('.')
        .filter_map(|s| s.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse::<u64>().ok())
        .collect()
}

fn compare(a: &str, b: &str) -> std::cmp::Ordering {
    let av = parse_version(a);
    let bv = parse_version(b);
    for i in 0..av.len().max(bv.len()) {
        let x = av.get(i).copied().unwrap_or(0);
        let y = bv.get(i).copied().unwrap_or(0);
        match x.cmp(&y) {
            std::cmp::Ordering::Equal => continue,
            o => return o,
        }
    }
    std::cmp::Ordering::Equal
}

fn http_get_json(url: &str) -> Result<serde_json::Value, String> {
    let resp = ureq::get(url)
        .set("User-Agent", "workbench")
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .map_err(|e| format!("请求失败: {e}"))?;
    resp.into_json().map_err(|e| format!("解析响应失败: {e}"))
}

/// 检查更新（原生 HTTP，不再调用系统命令行工具）：
/// - update_url 形如 "owner/repo" 时走 GitHub Releases latest API
/// - 否则直接 GET 该 URL，期望返回 JSON（含 version 或 tag_name 字段）或纯文本版本号
/// 返回最新版本号与发布页地址，前端据此渲染「发现新版本」提醒。
#[tauri::command]
pub fn check_update(update_url: String, current_version: String) -> Result<UpdateInfo, String> {
    let trimmed = update_url.trim().to_string();
    if trimmed.is_empty() {
        return Ok(UpdateInfo {
            current: current_version,
            latest: None,
            has_update: false,
            release_url: None,
        });
    }

    let (latest, release_url) = if !trimmed.contains("://") && trimmed.split('/').count() == 2 {
        // GitHub 仓库形式 owner/repo
        let api = format!("https://api.github.com/repos/{}/releases/latest", trimmed);
        let json = http_get_json(&api)?;
        let tag = json["tag_name"].as_str().unwrap_or("").trim().to_string();
        let html = json["html_url"].as_str().unwrap_or("").trim().to_string();
        (Some(tag), Some(html))
    } else {
        // 自定义 JSON / 文本端点
        let json = http_get_json(&trimmed)?;
        let latest = json["tag_name"]
            .as_str()
            .or_else(|| json["version"].as_str())
            .map(|s| s.trim().to_string())
            .or_else(|| json.as_str().map(|s| s.trim().to_string()))
            .unwrap_or_default();
        // 自定义端点可自带发布页地址（云端 app-release.json 的 url 字段）
        let url = json["url"]
            .as_str()
            .or_else(|| json["html_url"].as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        (Some(latest), url)
    };

    let has_update = latest
        .as_ref()
        .map(|l| compare(l, &current_version) == std::cmp::Ordering::Greater)
        .unwrap_or(false);

    Ok(UpdateInfo {
        current: current_version,
        latest,
        has_update,
        release_url,
    })
}
