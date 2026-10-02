use serde::Serialize;

#[derive(Serialize)]
pub struct DiskInfo {
    pub mount: String,
    pub total: u64,
    pub free: u64,
    pub used: u64,
    pub used_percent: f64,
}

/// 磁盘空间命令：通过 PowerShell CIM 读取本机逻辑磁盘（C/D/E 等）余量。
/// 返回 { mount, total, free, used, used_percent } 列表。
#[tauri::command]
pub fn disk_space() -> Result<Vec<DiskInfo>, String> {
    let script = r#"
$drives = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3"
$drives | ForEach-Object {
  [PSCustomObject]@{
    Device = $_.DeviceID
    Total  = [double]$_.Size
    Free   = [double]$_.FreeSpace
  }
} | ConvertTo-Json -Compress
"#;
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| format!("powershell 调用失败: {e}"))?;

    let text = String::from_utf8_lossy(&out.stdout);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("未获取到磁盘数据".into());
    }

    let v: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| format!("解析磁盘 JSON 失败: {e}"))?;
    let arr = match v {
        serde_json::Value::Array(a) => a,
        other => vec![other],
    };

    let mut result = Vec::new();
    for item in arr {
        let mount = item["Device"].as_str().unwrap_or("").to_string();
        let total = item["Total"].as_f64().unwrap_or(0.0) as u64;
        let free = item["Free"].as_f64().unwrap_or(0.0) as u64;
        let used = total.saturating_sub(free);
        let used_percent = if total > 0 {
            (used as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        result.push(DiskInfo {
            mount,
            total,
            free,
            used,
            used_percent,
        });
    }
    Ok(result)
}
