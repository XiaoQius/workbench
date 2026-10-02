use serde::Serialize;
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;

const NO_WINDOW: u32 = 0x0800_0000;

#[derive(Serialize)]
pub struct InstalledApp {
    pub name: String,
    pub exe_path: Option<String>,
    pub lnk_path: Option<String>,
    pub source: String, // "start-menu" | "registry"
}

fn ps(script: &str) -> Result<String, String> {
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(NO_WINDOW)
        .output()
        .map_err(|e| format!("powershell 调用失败: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn home_dir() -> PathBuf {
    std::env::var("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("C:/Users"))
}

/// 扫描开始菜单快捷方式（公共 + 当前用户）
fn scan_start_menu(apps: &mut Vec<InstalledApp>, seen: &mut std::collections::HashSet<String>) {
    let dirs = [
        PathBuf::from("C:/ProgramData/Microsoft/Windows/Start Menu/Programs"),
        home_dir().join("AppData/Roaming/Microsoft/Windows/Start Menu/Programs"),
    ];
    for dir in dirs {
        if !dir.exists() {
            continue;
        }
        let mut stack = vec![dir];
        while let Some(d) = stack.pop() {
            let entries = match fs::read_dir(&d) {
                Ok(e) => e,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    stack.push(p);
                    continue;
                }
                let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
                if ext.eq_ignore_ascii_case("lnk") {
                    let name = p
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    if name.trim().is_empty() || seen.contains(&name) {
                        continue;
                    }
                    seen.insert(name.clone());
                    apps.push(InstalledApp {
                        name,
                        exe_path: None,
                        lnk_path: Some(p.to_string_lossy().to_string()),
                        source: "start-menu".to_string(),
                    });
                }
            }
        }
    }
}

/// 扫描注册表 Uninstall 项（HKCU + HKLM 32/64 位）
fn scan_registry(apps: &mut Vec<InstalledApp>, seen: &mut std::collections::HashSet<String>) {
    let bases = [
        "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
        "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
        "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
    ];
    for base in bases {
        let script = format!(
            "Get-ItemProperty '{b}' -ErrorAction SilentlyContinue | Where-Object {{ $_.DisplayName }} | ForEach-Object {{ $exe = $null; if ($_.DisplayIcon) {{ $exe = ($_.DisplayIcon -split ',')[0] }} elseif ($_.InstallLocation -and (Test-Path (Join-Path $_.InstallLocation 'uninstall.exe'))) {{ $exe = Join-Path $_.InstallLocation 'uninstall.exe' }}; Write-Output (($_.DisplayName -replace '\\|', ';') + '|' + $exe) }}",
            b = base
        );
        let out = match ps(&script) {
            Ok(o) => o,
            Err(_) => continue,
        };
        for line in out.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let mut parts = line.splitn(2, '|');
            let name = parts.next().unwrap_or("").trim().to_string();
            let exe = parts.next().unwrap_or("").trim().to_string();
            if name.is_empty() || seen.contains(&name) {
                continue;
            }
            // 过滤明显是卸载器/系统组件的项
            if exe.to_lowercase().contains("unins") {
                continue;
            }
            seen.insert(name.clone());
            apps.push(InstalledApp {
                name,
                exe_path: if exe.is_empty() { None } else { Some(exe) },
                lnk_path: None,
                source: "registry".to_string(),
            });
        }
    }
}

/// 自动识别本机已安装程序：
/// 1) 开始菜单快捷方式（递归扫描，名称即程序名，.lnk 待解析目标）
/// 2) 注册表 Uninstall 项（DisplayName + DisplayIcon/InstallLocation 推断 exe）
/// 供「添加工具」弹窗直接选择添加，替代手填路径。
#[tauri::command]
pub fn list_installed_apps() -> Result<Vec<InstalledApp>, String> {
    let mut apps = Vec::new();
    let mut seen = std::collections::HashSet::new();
    scan_start_menu(&mut apps, &mut seen);
    scan_registry(&mut apps, &mut seen);
    // 按名称排序
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(apps)
}

/// 解析 Windows 快捷方式（.lnk）的目标程序路径，供添加工具时取真实 exe。
#[tauri::command]
pub fn resolve_shortcut(lnk_path: String) -> Result<Option<String>, String> {
    let script = format!(
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('{p}'); if ($s.TargetPath) {{ Write-Output $s.TargetPath }}",
        p = lnk_path.replace('\'', "''")
    );
    let out = ps(&script)?;
    let target = out.trim().to_string();
    if target.is_empty() || target.starts_with("ERR") {
        Ok(None)
    } else {
        Ok(Some(target))
    }
}
