use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct BackupInfo {
    pub name: String,
    pub size: u64,
    pub modified: u64,
}

#[derive(Serialize)]
pub struct BackupVerify {
    pub name: String,
    pub size: u64,
    pub modified: u64,
    pub valid: bool,
    pub tables: usize,
    pub records: usize,
    pub error: Option<String>,
}

fn backups_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?
        .join("backups");
    fs::create_dir_all(&dir).map_err(|e| format!("创建备份目录失败: {e}"))?;
    Ok(dir)
}

fn timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 数据导出（系统底座）：将前端汇总的 JSON 备份写入应用数据目录 backups 文件夹。
/// 返回备份文件名（如 workbench-1710000000.json）。
#[tauri::command]
pub async fn export_backup(app: AppHandle, json: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let dir = backups_dir(&app)?;
        let name = format!("workbench-{}.json", timestamp());
        let path = dir.join(&name);
        fs::write(&path, json).map_err(|e| format!("写入备份失败: {e}"))?;
        Ok(name)

    })
    .await
    .map_err(|e| format!("{e}"))?
}

/// 备份列表（系统底座）：返回 backups 目录下全部 .json 备份文件。
#[tauri::command]
pub async fn list_backups(app: AppHandle) -> Result<Vec<BackupInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let dir = backups_dir(&app)?;
        let mut out = Vec::new();
        for entry in fs::read_dir(&dir).map_err(|e| format!("读取备份目录失败: {e}"))? {
            let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
            let path = entry.path();
            if path.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let meta = fs::metadata(&path).map_err(|e| format!("读取元数据失败: {e}"))?;
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            out.push(BackupInfo {
                name,
                size: meta.len(),
                modified: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
            });
        }
        out.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(out)

    })
    .await
    .map_err(|e| format!("{e}"))?
}

/// 备份读取（系统底座）：按文件名读取备份 JSON 内容，供前端导入恢复。
#[tauri::command]
pub async fn read_backup(app: AppHandle, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let dir = backups_dir(&app)?;
        // 防路径穿越：仅允许文件名
        let file_name = PathBuf::from(&name)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .ok_or_else(|| "备份文件名无效".to_string())?;
        let path = dir.join(&file_name);
        if !path.is_file() {
            return Err(format!("备份不存在: {file_name}"));
        }
        fs::read_to_string(&path).map_err(|e| format!("读取备份失败: {e}"))

    })
    .await
    .map_err(|e| format!("{e}"))?
}

/// 导出备份到指定目录（F-SYS-07 Git 数据同步底座）：
/// 将前端汇总的 JSON 备份写入用户指定的仓库/同步目录，供 Git 提交多机同步。
/// 安全约束：拒绝写入系统核心目录；只接受绝对路径。
#[tauri::command]
pub async fn export_backup_to(path: String, json: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let p = PathBuf::from(&path);
        if !p.is_absolute() {
            return Err("目标路径必须为绝对路径".to_string());
        }
        let lower = path.to_lowercase();
        for bad in [
            "c:\\windows",
            "c:\\program files",
            "c:\\program files (x86)",
            "c:\\programdata",
            "c:\\users\\default",
        ] {
            if lower.starts_with(bad) {
                return Err(format!("拒绝写入系统目录: {bad}"));
            }
        }
        fs::create_dir_all(&p).map_err(|e| format!("创建目录失败: {e}"))?;
        let name = format!("workbench-{}.json", timestamp());
        let target = p.join(&name);
        fs::write(&target, json).map_err(|e| format!("写入同步目录失败: {e}"))?;
        Ok(target.to_string_lossy().to_string())

    })
    .await
    .map_err(|e| format!("{e}"))?
}
#[tauri::command]
pub async fn backup_verify(app: AppHandle) -> Result<Vec<BackupVerify>, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let dir = backups_dir(&app)?;
        let mut out = Vec::new();
        for entry in fs::read_dir(&dir).map_err(|e| format!("读取备份目录失败: {e}"))? {
            let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
            let path = entry.path();
            if path.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let meta = fs::metadata(&path).map_err(|e| format!("读取元数据失败: {e}"))?;
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let (valid, tables, records, error) = match fs::read_to_string(&path) {
                Ok(raw) => match serde_json::from_str::<serde_json::Value>(&raw) {
                    Ok(v) if v.is_object() => {
                        let obj = v.as_object().cloned().unwrap_or_default();
                        let tables = obj.len();
                        let records = obj
                            .values()
                            .filter(|x| x.is_array())
                            .map(|x| x.as_array().map(|a| a.len()).unwrap_or(0))
                            .sum();
                        (true, tables, records, None)
                    }
                    Ok(_) => (false, 0, 0, Some("备份不是 JSON 对象".to_string())),
                    Err(e) => (false, 0, 0, Some(format!("JSON 解析失败: {e}"))),
                },
                Err(e) => (false, 0, 0, Some(format!("读取失败: {e}"))),
            };
            out.push(BackupVerify {
                name,
                size: meta.len(),
                modified: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
                valid,
                tables,
                records,
                error,
            });
        }
        out.sort_by(|a, b| b.modified.cmp(&a.modified));
        Ok(out)

    })
    .await
    .map_err(|e| format!("{e}"))?
}
