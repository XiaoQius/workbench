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

/// 从 Release 页面 URL（.../releases/tag/v0.1.8）解析 tag；非该格式返回空。
fn tag_from_release_page(url: &str) -> String {
    let marker = "/releases/tag/";
    match url.rfind(marker) {
        Some(i) => {
            let t = url[i + marker.len()..].trim().trim_end_matches('/').to_string();
            if t.is_empty() || t.contains('/') {
                String::new()
            } else {
                t
            }
        }
        None => String::new(),
    }
}

fn msi_file_name(version: &str) -> String {
    let v = version.trim().trim_start_matches('v');
    format!("WORKBENCH_{}_x64_zh-CN.msi", v)
}

fn updater_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join("workbench-updater");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// 应用内更新：下载 MSI 安装包到 %TEMP%\workbench-updater 并校验，返回本地路径。
/// url 传 Release 页（.../releases/tag/<tag>）时解析 tag 拼产物直链；
/// 直链 404 时回退 GitHub Releases API 的 assets 下载端点（带 Accept: octet-stream 跟随重定向）。
#[tauri::command]
pub async fn download_update(url: String, version: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let tag = tag_from_release_page(&url);
        if tag.is_empty() {
            return Err("无法从发布页地址解析版本号，请在浏览器中手动下载".to_string());
        }
        let file = msi_file_name(&version);
        let direct = format!(
            "https://github.com/XiaoQius/workbench/releases/download/{}/{}",
            tag, file
        );

        std::fs::create_dir_all(updater_dir()).map_err(|e| format!("创建下载目录失败: {e}"))?;
        let dest = updater_dir().join(&file);
        let _ = std::fs::remove_file(&dest);

        // 直链；失败则回退 api.github.com assets 端点
        if let Err(e1) = fetch_to_file(&direct, &dest) {
            let api = "https://api.github.com/repos/XiaoQius/workbench/releases/latest";
            let asset_url = http_get_json(api)
                .ok()
                .and_then(|j| {
                    j["assets"]
                        .as_array()?
                        .iter()
                        .find(|a| a["name"].as_str() == Some(file.as_str()))
                        .and_then(|a| a["url"].as_str())
                        .map(|s| s.to_string())
                });
            match asset_url {
                Some(u) => fetch_to_file(&u, &dest).map_err(|e2| format!("{e2}（直链失败: {e1}）"))?,
                None => return Err(format!("{e1}（仓库 latest 接口未提供该安装包）")),
            }
        }

        // 校验：MSI 为 OLE 复合文档，魔数 D0 CF 11 E0 A1 B1 1A E1（非 PE 的 MZ）
        let bytes = std::fs::read(&dest).map_err(|e| format!("读取下载文件失败: {e}"))?;
        if bytes.len() < 1024 || &bytes[..8] != b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" {
            let _ = std::fs::remove_file(&dest);
            return Err("下载内容校验失败（不是有效的安装包），已删除".to_string());
        }
        Ok(dest.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("{e}"))?
}

fn fetch_to_file(url: &str, dest: &std::path::Path) -> Result<(), String> {
    use std::io::Write;
    let resp = ureq::get(url)
        .set("User-Agent", "workbench")
        .set("Accept", "application/octet-stream")
        .timeout(std::time::Duration::from_secs(120))
        .call()
        .map_err(|e| format!("下载失败: {e}"))?;
    let mut reader = resp.into_reader();
    let mut writer = std::io::BufWriter::new(
        std::fs::File::create(dest).map_err(|e| format!("创建文件失败: {e}"))?,
    );
    std::io::copy(&mut reader, &mut writer).map_err(|e| format!("写入失败: {e}"))?;
    writer.flush().map_err(|e| format!("写入失败: {e}"))?;
    Ok(())
}

/// 拉起安装：msiexec /passive 显示进度条但无需交互；不等安装完成，拉起即返回。
#[tauri::command]
pub async fn install_update(file_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !std::path::Path::new(&file_path).exists() {
            return Err(format!("安装包不存在: {file_path}"));
        }
        // start 会拉起新窗口（msiexec 进度界面），属预期行为；cmd 自身不闪黑框
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", "msiexec", "/i", &file_path, "/passive"])
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| format!("启动安装失败: {e}"))?;
        Ok("已启动安装程序，请按进度条提示完成更新".to_string())
    })
    .await
    .map_err(|e| format!("{e}"))?
}

/// 检查更新（原生 HTTP，不再调用系统命令行工具）：
/// - update_url 形如 "owner/repo" 时走 GitHub Releases latest API
/// - 否则直接 GET 该 URL，期望返回 JSON（含 version 或 tag_name 字段）或纯文本版本号
/// 返回最新版本号与发布页地址，前端据此渲染「发现新版本」提醒。
#[tauri::command]
pub async fn check_update(update_url: String, current_version: String) -> Result<UpdateInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {

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

    })
    .await
    .map_err(|e| format!("{e}"))?
}
