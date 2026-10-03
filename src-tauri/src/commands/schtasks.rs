use serde::Serialize;
use std::os::windows::process::CommandExt;

#[derive(Serialize)]
pub struct ScheduledTask {
    pub task_name: String,
    pub next_run: String,
    pub status: String,
    pub last_run: String,
    pub last_result: String,
}

/// 定时任务台账命令（F-DEV-10）：列出系统计划任务（schtasks）。
/// 通过 PowerShell + ConvertFrom-Csv 解析，输出 UTF-8 JSON。
#[tauri::command]
pub async fn schtasks_list() -> Result<Vec<ScheduledTask>, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let script = r#"
    [Console]::OutputEncoding=[Text.Encoding]::UTF8
    $rows = @()
    $out = schtasks /Query /FO CSV /V 2>$null
    if (-not $out) { Write-Output '[]'; exit 0 }
    $csv = ($out -join "`n")
    if ($csv.StartsWith([char]0xFEFF)) { $csv = $csv.Substring(1) }
    $items = $csv | ConvertFrom-Csv
    foreach ($i in $items) {
        $rows += @{
            task_name = [string]$i.TaskName
            next_run = [string]$i.'Next Run Time'
            status = [string]$i.Status
            last_run = [string]$i.'Last Run Time'
            last_result = [string]$i.'Last Result'
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
            .map_err(|e| format!("解析 schtasks 输出失败: {e} -> {trimmed}"))?;
        let items = match v {
            serde_json::Value::Array(a) => a,
            other => vec![other],
        };
        let mut result = Vec::new();
        for item in items {
            result.push(ScheduledTask {
                task_name: item["task_name"].as_str().unwrap_or_default().to_string(),
                next_run: item["next_run"].as_str().unwrap_or_default().to_string(),
                status: item["status"].as_str().unwrap_or_default().to_string(),
                last_run: item["last_run"].as_str().unwrap_or_default().to_string(),
                last_result: item["last_result"].as_str().unwrap_or_default().to_string(),
            });
        }
        Ok(result)

    })
    .await
    .map_err(|e| format!("{e}"))?
}
