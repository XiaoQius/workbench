use serde::Serialize;

#[derive(Serialize)]
pub struct UpdateInfo {
    pub current: String,
    pub latest: Option<String>,
    pub has_update: bool,
    pub release_url: Option<String>,
}

fn ps(script: &str) -> Result<String, String> {
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| format!("powershell 调用失败: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
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

/// 检查更新：
/// - update_url 形如 "owner/repo" 时走 GitHub Releases latest API
/// - 否则直接 GET 该 URL，期望返回 JSON（含 version 或 tag_name 字段）或纯文本版本号
/// 返回最新版本号与发布页地址，前端据此渲染「发现新版本」提醒。
#[tauri::command]
pub fn check_update(update_url: String, current_version: String) -> Result<UpdateInfo, String> {
    let latest: Option<String>;
    let release_url: Option<String>;
    let trimmed = update_url.trim().to_string();
    if trimmed.is_empty() {
        return Ok(UpdateInfo {
            current: current_version,
            latest: None,
            has_update: false,
            release_url: None,
        });
    }
    if !trimmed.contains("://") && trimmed.split('/').count() == 2 {
        // GitHub 仓库形式 owner/repo
        let api = format!("https://api.github.com/repos/{}/releases/latest", trimmed);
        let script = format!(
            "try {{ $r = Invoke-RestMethod -Uri '{api}' -Headers @{{ 'User-Agent' = 'workbench' }} -TimeoutSec 10; Write-Output ($r.tag_name + '|' + $r.html_url) }} catch {{ Write-Output ('ERR:' + $_.Exception.Message) }}",
            api = api
        );
        let out = ps(&script)?;
        if out.starts_with("ERR:") {
            return Err(format!("检查更新失败: {}", out));
        }
        let mut parts = out.splitn(2, '|');
        latest = Some(parts.next().unwrap_or("").trim().to_string());
        release_url = Some(parts.next().unwrap_or("").trim().to_string());
    } else {
        // 自定义 JSON / 文本端点
        let script = format!(
            "try {{ $r = Invoke-RestMethod -Uri '{url}' -TimeoutSec 10; if ($r.tag_name) {{ Write-Output $r.tag_name }} elseif ($r.version) {{ Write-Output $r.version }} else {{ Write-Output ([string]$r) }} }} catch {{ Write-Output ('ERR:' + $_.Exception.Message) }}",
            url = trimmed
        );
        let out = ps(&script)?;
        if out.starts_with("ERR:") {
            return Err(format!("检查更新失败: {}", out));
        }
        latest = Some(out.trim().to_string());
        release_url = None;
    }

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
