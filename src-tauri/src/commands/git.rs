use serde::Serialize;

#[derive(Serialize)]
pub struct GitStatus {
    pub repo: String,
    pub branch: String,
    pub clean: bool,
    pub changed_files: usize,
    pub ahead: i64,
    pub behind: i64,
    pub stash_count: usize,
}

#[derive(Serialize)]
pub struct GitRemoteInfo {
    pub repo: String,
    pub is_repo: bool,
    pub remote: Option<String>,
    pub remote_url: Option<String>,
    pub branch: String,
    pub changed_files: usize,
}

fn git(repo: &str, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|e| format!("git 调用失败: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        return Err(if !err.is_empty() { err } else { stdout });
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// 版本管理总览：是否已是 git 仓库 / 远端地址 / 当前分支 / 未提交改动数。
/// 供「Git 版本管理」面板首屏判断：未初始化时引导一键 init。
#[tauri::command]
pub fn git_remote_info(repo_path: String) -> Result<GitRemoteInfo, String> {
    let is_repo = std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
        .unwrap_or(false);
    if !is_repo {
        return Ok(GitRemoteInfo {
            repo: repo_path,
            is_repo: false,
            remote: None,
            remote_url: None,
            branch: String::new(),
            changed_files: 0,
        });
    }
    let branch = git(&repo_path, &["branch", "--show-current"]).unwrap_or_default();
    let remote = git(&repo_path, &["remote"]).unwrap_or_default();
    let remote_url = git(&repo_path, &["remote", "get-url", "origin"]).unwrap_or_default();
    let changed = git(&repo_path, &["status", "--porcelain"])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0);
    Ok(GitRemoteInfo {
        repo: repo_path,
        is_repo: true,
        remote: if remote.is_empty() { None } else { Some(remote) },
        remote_url: if remote_url.is_empty() { None } else { Some(remote_url) },
        branch,
        changed_files: changed,
    })
}

/// 一键初始化版本管理：git init + 首次提交（初始 commit）。
#[tauri::command]
pub fn git_init_repo(repo_path: String) -> Result<String, String> {
    git(&repo_path, &["init"])?;
    git(&repo_path, &["add", "-A"])?;
    let msg = "chore: workbench 初始化版本管理";
    git(&repo_path, &["commit", "-m", msg])?;
    Ok(format!("已初始化 git 仓库并完成首次提交（{}）", msg))
}

/// 提交全部改动：add -A + commit。
#[tauri::command]
pub fn git_commit_all(repo_path: String, message: String) -> Result<String, String> {
    let msg = if message.trim().is_empty() {
        "chore: workbench 同步改动".to_string()
    } else {
        message.trim().to_string()
    };
    git(&repo_path, &["add", "-A"])?;
    git(&repo_path, &["commit", "-m", &msg])?;
    Ok(format!("已提交：{}", msg))
}

/// 上传 GitHub：使用 gh CLI 创建仓库并推送（--source 本地目录，自动 set upstream）。
/// is_private=true 创建私有仓库。
#[tauri::command]
pub fn git_gh_upload(repo_path: String, repo_name: String, is_private: bool) -> Result<String, String> {
    let name = if repo_name.trim().is_empty() {
        "workbench".to_string()
    } else {
        repo_name.trim().to_string()
    };
    // 先确认 gh 已登录
    let auth = std::process::Command::new("gh")
        .args(["auth", "status"])
        .output()
        .map_err(|e| format!("gh CLI 调用失败: {e}"))?;
    let auth_text = String::from_utf8_lossy(&auth.stdout) + &String::from_utf8_lossy(&auth.stderr);
    if !auth.status.success() {
        return Err(format!("gh 未登录，请先执行 gh auth login：{}", auth_text.trim()));
    }
    let vis = if is_private { "--private" } else { "--public" };
    let out = std::process::Command::new("gh")
        .args(["repo", "create", &name, "--source", &repo_path, "--push", vis])
        .output()
        .map_err(|e| format!("gh repo create 调用失败: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout) + &String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(format!("gh 上传失败：{}", text.trim()));
    }
    Ok(format!("已创建并推送 GitHub 仓库：https://github.com/{}", text.trim()))
}

/// Git 状态命令：对项目目录检查未提交改动 / 未 push / 落后远端 / stash，
/// 用于开发页「Git 清洁度检查」（丢代码高风险点识别）。
#[tauri::command]
pub fn git_status(repo_path: String) -> Result<GitStatus, String> {
    let status_raw = git(&repo_path, &["status", "--porcelain"])?;
    let changed_lines: Vec<&str> = status_raw.lines().filter(|l| !l.trim().is_empty()).collect();
    let changed_files = changed_lines.len();

    // 仅统计未提交的改动行（排除 ?? 未跟踪以外全部视为 dirty）
    let clean = changed_files == 0;

    let branch = git(&repo_path, &["branch", "--show-current"]).unwrap_or_default();
    if branch.is_empty() {
        return Ok(GitStatus {
            repo: repo_path,
            branch: "(detached)".to_string(),
            clean,
            changed_files,
            ahead: 0,
            behind: 0,
            stash_count: 0,
        });
    }

    // ahead：本地领先远端（未 push 的提交数）；无 upstream 时按 0 处理
    let ahead = git(&repo_path, &["rev-list", "--count", "@{u}..HEAD"])
        .ok()
        .and_then(|s| s.trim().parse::<i64>().ok())
        .unwrap_or(0);
    // behind：落后远端（远端有新提交未拉取）
    let behind = git(&repo_path, &["rev-list", "--count", "HEAD..@{u}"])
        .ok()
        .and_then(|s| s.trim().parse::<i64>().ok())
        .unwrap_or(0);

    let stash_count = git(&repo_path, &["stash", "list"])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0);

    Ok(GitStatus {
        repo: repo_path,
        branch,
        clean,
        changed_files,
        ahead,
        behind,
        stash_count,
    })
}
