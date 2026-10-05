use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub techs: Vec<String>,
    pub has_git: bool,
    pub last_modified: u64,
}

const SKIP_DIRS: [&str; 8] = [
    "node_modules", ".git", "target", "dist", "build", "out", ".idea", ".vscode",
];

fn probe_techs(dir: &Path) -> Vec<String> {
    let mut techs = Vec::new();
    let mut check = |file: &str, label: &str| {
        if dir.join(file).exists() {
            techs.push(label.to_string());
        }
    };
    check("package.json", "Node");
    check("pnpm-lock.yaml", "pnpm");
    check("yarn.lock", "yarn");
    check("Cargo.toml", "Rust");
    check("pyproject.toml", "Python");
    check("requirements.txt", "Python");
    check("go.mod", "Go");
    check("pom.xml", "Java");
    check("build.gradle", "Gradle");
    check("drizzle.config.ts", "Drizzle");
    // 解决方案文件需 glob 探测
    if let Ok(rd) = std::fs::read_dir(dir) {
        if rd.flatten().any(|e| {
            e.path()
                .extension()
                .map(|x| x == "sln")
                .unwrap_or(false)
        }) {
            techs.push("DotNet".to_string());
        }
    }
    // 常见框架指纹
    if dir.join("vite.config.ts").exists() {
        techs.push("Vite".to_string());
    }
    if dir.join("src-tauri").is_dir() {
        techs.push("Tauri".to_string());
    }
    if dir.join("src").join("App.vue").exists() {
        techs.push("Vue".to_string());
    }
    techs
}

fn walk(dir: &Path, depth: usize, max_depth: usize, out: &mut Vec<ProjectInfo>) {
    if depth > max_depth {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    let has_git = dir.join(".git").exists();
    let techs = probe_techs(dir);

    if has_git {
        let name = dir
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let last_modified = std::fs::metadata(dir.join(".git"))
            .and_then(|m| m.modified())
            .map(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0)
            })
            .unwrap_or(0);
        out.push(ProjectInfo {
            name,
            path: dir.to_string_lossy().to_string(),
            techs,
            has_git: true,
            last_modified,
        });
        return; // 已是项目根，不再深入（避免重复）
    }

    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name = p
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if SKIP_DIRS.contains(&name.as_str()) {
            continue;
        }
        walk(&p, depth + 1, max_depth, out);
    }
}

/// 项目扫描命令：扫描 root 下含 .git 的项目目录，探测技术栈。
/// root 由前端传入（默认用户主目录，见 useTauri.scanProjects）。
#[tauri::command]
pub async fn scan_projects(root: String, max_depth: Option<usize>) -> Result<Vec<ProjectInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {

        let depth = max_depth.unwrap_or(3);
        let root_path = Path::new(&root);
        if !root_path.is_dir() {
            return Err(format!("目录不存在: {root}"));
        }
        let mut projects = Vec::new();
        walk(root_path, 0, depth, &mut projects);
        projects.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
        Ok(projects)

    })
    .await
    .map_err(|e| format!("{e}"))?
}
