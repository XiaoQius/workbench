use serde::Serialize;
use std::os::windows::process::CommandExt;

#[derive(Serialize)]
pub struct WslDistro {
    pub name: String,
    pub state: String,
    pub version: String,
}

/// WSL 发行版状态命令（F-OPS-11）：列出各发行版与运行状态。
/// 通过 PowerShell 中转，规避 wsl.exe 直出 UTF-16 编码问题，输出 JSON。
#[tauri::command]
pub async fn wsl_status() -> Result<Vec<WslDistro>, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let script = r#"
    [Console]::OutputEncoding=[Text.Encoding]::UTF8
    $rows = @()
    $lines = wsl --list --verbose 2>$null
    foreach ($line in ($lines | Select-Object -Skip 1)) {
        $t = ($line -replace [char]0x00A0, ' ').Trim()
        if (-not $t) { continue }
        if ($t -match '^(NAME|名称)') { continue }
        $t = $t -replace '^\*', ''
        $t = $t.TrimStart()
        $p = ($t -split '\s+')
        if ($p.Count -ge 3) {
            $rows += @{ name = $p[0]; state = $p[1]; version = $p[2] }
        }
    }
    ConvertTo-Json @($rows) -Compress
    "#;
    let out = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .creation_flags(0x0800_0000u32)
            .output()
            .map_err(|e| format!("powershell 调用失败: {e}"))?;
        let text = String::from_utf8_lossy(&out.stdout);
        let trimmed = text.trim();
        if trimmed.is_empty() || trimmed == "[]" || trimmed == "null" {
            return Ok(Vec::new());
        }
        let v: serde_json::Value = serde_json::from_str(trimmed)
            .map_err(|e| format!("解析 wsl 输出失败: {e} -> {trimmed}"))?;
        let items = match v {
            serde_json::Value::Array(a) => a,
            other => vec![other],
        };
        let mut result = Vec::new();
        for item in items {
            result.push(WslDistro {
                name: item["name"].as_str().unwrap_or_default().to_string(),
                state: item["state"].as_str().unwrap_or_default().to_string(),
                version: item["version"].as_str().unwrap_or_default().to_string(),
            });
        }
        Ok(result)

    })
    .await
    .map_err(|e| format!("{e}"))?
}
