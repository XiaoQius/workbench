use serde::Serialize;
use std::collections::HashMap;
use std::os::windows::process::CommandExt;

/// 后台静默执行：不闪命令行窗口（CREATE_NO_WINDOW）
const NO_WINDOW: u32 = 0x0800_0000;

fn run_cmd(prog: &str, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new(prog)
        .args(args)
        .creation_flags(NO_WINDOW)
        .output()
        .map_err(|e| format!("命令调用失败: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "命令失败: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[derive(Serialize)]
pub struct GitCommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub date: String,
    pub message: String,
}

/// 启动本机程序（工具启动台 cmd 类型）。target 可以是：
/// ① exe 完整路径（可带命令行参数，按第一个空格拆分）；② PATH 里的命令 / 协议链接（交系统解析）。
/// CREATE_NO_WINDOW 避免闪黑框。
#[tauri::command]
pub async fn launch_app(target: String, args: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let trimmed = target.trim().to_string();
        if trimmed.is_empty() {
            return Err("启动目标为空".to_string());
        }
        let extra = args.unwrap_or_default();
        let extra = extra.trim().to_string();
        // 整个 target 就是存在的文件：直接拉起
        if std::path::Path::new(&trimmed).exists() {
            let mut cmd = std::process::Command::new(&trimmed);
            if !extra.is_empty() {
                cmd.args(extra.split_whitespace());
            }
            return cmd
                .creation_flags(NO_WINDOW)
                .spawn()
                .map(|_| format!("已启动: {trimmed}"))
                .map_err(|e| format!("启动失败: {e}"));
        }
        // 带参数的「exe + 参数」连写：按第一个空格拆开，exe 存在则直接拉起
        if let Some((exe, inline_args)) = trimmed.split_once(' ') {
            if std::path::Path::new(exe).exists() {
                let mut cmd = std::process::Command::new(exe);
                cmd.args(inline_args.split_whitespace());
                if !extra.is_empty() {
                    cmd.args(extra.split_whitespace());
                }
                return cmd
                    .creation_flags(NO_WINDOW)
                    .spawn()
                    .map(|_| format!("已启动: {exe}"))
                    .map_err(|e| format!("启动失败: {e}"));
            }
        }
        // 兜底：绝对路径但文件不存在 → 明确报错；其余（命令 / 协议）交系统 Shell 解析
        let looks_like_path = trimmed.starts_with("\\\\") || trimmed.chars().nth(1) == Some(':');
        if looks_like_path {
            return Err(format!("文件不存在: {trimmed}"));
        }
        let full = if extra.is_empty() { trimmed.clone() } else { format!("{trimmed} {extra}") };
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &full])
            .creation_flags(NO_WINDOW)
            .spawn()
            .map(|_| format!("已交给系统启动: {trimmed}"))
            .map_err(|e| format!("启动失败: {e}"))
    })
    .await
    .map_err(|e| format!("{e}"))?
}

/// 一键打开项目目录（F-DEV-04）：Windows 下用 explorer 打开目录；若传入
/// vscode:// / cursor:// / trae:// 协议链接则直接调用系统默认处理。
#[tauri::command]
pub async fn open_path(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {

        if path.starts_with("vscode://") || path.starts_with("cursor://") || path.starts_with("trae://") {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &path])
                .creation_flags(NO_WINDOW)
                .spawn()
                .map_err(|e| format!("打开协议失败: {e}"))?;
            return Ok(format!("已通过系统协议打开: {path}"));
        }
        // http/https：交给系统默认浏览器（Tauri WebView2 内 window.open 无效）
        if path.starts_with("http://") || path.starts_with("https://") {
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &path])
                .creation_flags(NO_WINDOW)
                .spawn()
                .map_err(|e| format!("打开浏览器失败: {e}"))?;
            return Ok(format!("已在默认浏览器打开: {path}"));
        }
        if std::path::Path::new(&path).exists() {
            std::process::Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| format!("打开目录失败: {e}"))?;
            Ok(format!("已在资源管理器中打开: {path}"))
        } else {
            Err(format!("路径不存在: {path}"))
        }

    })
    .await
    .map_err(|e| format!("{e}"))?
}

/// Git 提交历史（F-DEV-15/17 Git 操作可视化）：返回最近 limit 条提交。
#[tauri::command]
pub async fn git_log(repo_path: String, limit: Option<usize>) -> Result<Vec<GitCommitInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let n = limit.unwrap_or(30).min(200);
        let raw = run_cmd(
            "git",
            &[
                "-C",
                &repo_path,
                "log",
                &format!("-{n}"),
                "--pretty=format:%h|%H|%an|%ad|%s",
                "--date=format:%Y-%m-%d %H:%M",
            ],
        )
        .map_err(|e| format!("git log 失败: {e}（需要 git 仓库）"))?;
        let mut list = Vec::new();
        for line in raw.lines().filter(|l| !l.trim().is_empty()) {
            let mut parts = line.splitn(5, '|');
            let short_hash = parts.next().unwrap_or("").to_string();
            let hash = parts.next().unwrap_or("").to_string();
            let author = parts.next().unwrap_or("").to_string();
            let date = parts.next().unwrap_or("").to_string();
            let message = parts.next().unwrap_or("").to_string();
            list.push(GitCommitInfo { hash, short_hash, author, date, message });
        }
        Ok(list)

    })
    .await
    .map_err(|e| format!("{e}"))?
}

#[derive(Serialize)]
pub struct LangStat {
    pub lang: String,
    pub files: usize,
    pub lines: usize,
}

/// 代码统计（F-DEV-16 代码统计）：按扩展名聚合常见源码文件数量与粗略行数。
#[tauri::command]
pub async fn code_stats(root: String) -> Result<Vec<LangStat>, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let mut counts: HashMap<String, (usize, usize)> = HashMap::new();
        let ext_map: &[(&str, &str)] = &[
            ("rs", "Rust"), ("ts", "TypeScript"), ("tsx", "TypeScript"), ("js", "JavaScript"),
            ("jsx", "JavaScript"), ("vue", "Vue"), ("py", "Python"), ("go", "Go"),
            ("java", "Java"), ("kt", "Kotlin"), ("swift", "Swift"), ("c", "C"), ("h", "C"),
            ("cpp", "C++"), ("hpp", "C++"), ("cs", "C#"), ("rb", "Ruby"), ("php", "PHP"),
            ("sh", "Shell"), ("ps1", "PowerShell"), ("sql", "SQL"), ("html", "HTML"),
            ("css", "CSS"), ("scss", "SCSS"), ("less", "LESS"), ("md", "Markdown"),
            ("json", "JSON"), ("yaml", "YAML"), ("yml", "YAML"), ("toml", "TOML"), ("xml", "XML"),
        ];
        let mut walk = |dir: &std::path::Path| -> Result<(), String> {
            let mut stack = vec![dir.to_path_buf()];
            let mut visited: usize = 0;
            let max_files: usize = 20_000;
            while let Some(d) = stack.pop() {
                if visited > max_files {
                    break;
                }
                let rd = std::fs::read_dir(&d).map_err(|e| format!("读取目录失败: {e}"))?;
                for ent in rd.flatten() {
                    let p = ent.path();
                    if p.is_dir() {
                        let name = ent.file_name().to_string_lossy().to_lowercase();
                        if ["node_modules", "target", "dist", ".git", ".svn", ".idea", "vendor", "__pycache__", ".next"]
                            .contains(&name.as_str())
                        {
                            continue;
                        }
                        stack.push(p);
                    } else {
                        visited += 1;
                        let ext = p
                            .extension()
                            .map(|e| e.to_string_lossy().to_lowercase())
                            .unwrap_or_default();
                        if let Some((_, lang)) = ext_map.iter().find(|(e, _)| *e == ext.as_str()) {
                            let lines = std::fs::read_to_string(&p)
                                .map(|s| s.lines().count())
                                .unwrap_or(0);
                            let entry = counts.entry(lang.to_string()).or_insert((0, 0));
                            entry.0 += 1;
                            entry.1 += lines;
                        }
                    }
                }
            }
            Ok(())
        };
        walk(std::path::Path::new(&root))?;
        let mut list: Vec<LangStat> = counts
            .into_iter()
            .map(|(lang, (files, lines))| LangStat { lang, files, lines })
            .collect();
        list.sort_by(|a, b| b.lines.cmp(&a.lines));
        Ok(list)

    })
    .await
    .map_err(|e| format!("{e}"))?
}

/// 环境变量清单（F-DEV-11）：列出常用环境变量名（含值），用于快速查看配置。
#[tauri::command]
pub async fn env_list() -> Result<Vec<(String, String)>, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let keys = [
            "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "TEMP",
            "TMP", "PATH", "JAVA_HOME", "NODE_HOME", "RUSTUP_HOME", "CARGO_HOME",
            "PYTHONHOME", "ANDROID_HOME", "WSLENV", "COMPUTERNAME", "USERNAME", "OS",
        ];
        let mut list = Vec::new();
        for k in keys {
            if let Ok(v) = std::env::var(k) {
                list.push((k.to_string(), v));
            }
        }
        Ok(list)

    })
    .await
    .map_err(|e| format!("{e}"))?
}

#[derive(Serialize)]
pub struct RepoHealth {
    pub repo: String,
    pub has_git: bool,
    pub branch: String,
    pub dirty_files: usize,
    pub ahead: i64,
    pub behind: i64,
    pub last_commit_at: String,
    pub last_commit_msg: String,
    pub has_cargo: bool,
    pub has_package_json: bool,
    pub has_readme: bool,
    pub has_ci: bool,
    pub size_mb: f64,
    pub file_count: usize,
}

/// 仓库体检（F-DEV-15）：git 状态 + 关键文件 + 目录体量，一次输出健康画像。
#[tauri::command]
pub async fn repo_health(repo_path: String) -> Result<RepoHealth, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let p = std::path::Path::new(&repo_path);
        if !p.is_dir() {
            return Err(format!("路径不是目录: {repo_path}"));
        }
        let has_git = p.join(".git").is_dir();
        let branch = if has_git {
            run_cmd("git", &["-C", &repo_path.clone(), "branch", "--show-current"]).unwrap_or_default()
        } else {
            String::new()
        };
        let dirty_lines = if has_git {
            run_cmd("git", &["-C", &repo_path.clone(), "status", "--porcelain"])
                .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
                .unwrap_or(0)
        } else {
            0
        };
        let ahead = if has_git {
            run_cmd("git", &["-C", &repo_path.clone(), "rev-list", "--count", "@{u}..HEAD"])
                .ok()
                .and_then(|s| s.trim().parse::<i64>().ok())
                .unwrap_or(0)
        } else {
            0
        };
        let behind = if has_git {
            run_cmd("git", &["-C", &repo_path.clone(), "rev-list", "--count", "HEAD..@{u}"])
                .ok()
                .and_then(|s| s.trim().parse::<i64>().ok())
                .unwrap_or(0)
        } else {
            0
        };
        let last_raw = if has_git {
            run_cmd("git", &["-C", &repo_path.clone(), "log", "-1", "--pretty=format:%ad|%s", "--date=format:%Y-%m-%d %H:%M"]).unwrap_or_default()
        } else {
            String::new()
        };
        let mut last_commit_at = String::new();
        let mut last_commit_msg = String::new();
        if let Some((d, m)) = last_raw.split_once('|') {
            last_commit_at = d.to_string();
            last_commit_msg = m.to_string();
        }

        let mut file_count = 0usize;
        let mut size_bytes: u64 = 0;
        let mut stack = vec![p.to_path_buf()];
        let mut visited = 0usize;
        while let Some(d) = stack.pop() {
            if visited > 30_000 {
                break;
            }
            if let Ok(rd) = std::fs::read_dir(&d) {
                for ent in rd.flatten() {
                    let fp = ent.path();
                    let name = ent.file_name().to_string_lossy().to_lowercase();
                    if ["node_modules", "target", "dist", ".git", ".svn", ".idea", "vendor", "__pycache__", ".next"]
                        .contains(&name.as_str())
                    {
                        continue;
                    }
                    if fp.is_dir() {
                        stack.push(fp);
                    } else if let Ok(md) = std::fs::metadata(&fp) {
                        file_count += 1;
                        size_bytes += md.len();
                        visited += 1;
                    }
                }
            }
        }

        Ok(RepoHealth {
            repo: repo_path.clone(),
            has_git,
            branch,
            dirty_files: dirty_lines,
            ahead,
            behind,
            last_commit_at,
            last_commit_msg,
            has_cargo: p.join("Cargo.toml").exists(),
            has_package_json: p.join("package.json").exists(),
            has_readme: p.join("README.md").exists() || p.join("README").exists(),
            has_ci: p.join(".github").exists() || p.join(".gitlab-ci.yml").exists(),
            size_mb: (size_bytes as f64) / 1024.0 / 1024.0,
            file_count,
        })

    })
    .await
    .map_err(|e| format!("{e}"))?
}

#[derive(Serialize)]
pub struct DepCheckItem {
    pub name: String,
    pub version: String,
    pub kind: String,
}

/// 依赖检查（F-DEV-16）：读取 package.json 的 dependencies / devDependencies，
/// 并提示 lockfile / 更新命令，帮助识别依赖更新状态。
#[tauri::command]
pub async fn deps_check(repo_path: String) -> Result<Vec<DepCheckItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let p = std::path::Path::new(&repo_path).join("package.json");
        if !p.exists() {
            return Err(format!("未找到 package.json: {repo_path}"));
        }
        let raw = std::fs::read_to_string(&p).map_err(|e| format!("读取 package.json 失败: {e}"))?;
        let json: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("解析 package.json 失败: {e}"))?;
        let mut items: Vec<DepCheckItem> = Vec::new();
        if let Some(deps) = json.get("dependencies").and_then(|v| v.as_object()) {
            for (name, v) in deps {
                items.push(DepCheckItem {
                    name: name.clone(),
                    version: v.as_str().unwrap_or("").to_string(),
                    kind: "dependency".to_string(),
                });
            }
        }
        if let Some(deps) = json.get("devDependencies").and_then(|v| v.as_object()) {
            for (name, v) in deps {
                items.push(DepCheckItem {
                    name: name.clone(),
                    version: v.as_str().unwrap_or("").to_string(),
                    kind: "devDependency".to_string(),
                });
            }
        }
        items.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(items)

    })
    .await
    .map_err(|e| format!("{e}"))?
}
