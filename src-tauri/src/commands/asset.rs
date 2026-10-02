use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
pub struct AssetInfo {
    pub name: String,
    pub path: String,
    pub category: String, // image | video | audio | model | doc | other
    pub ext: String,
    pub size: u64,
    pub modified: u64,
}

const SKIP_DIRS: [&str; 7] = [
    "node_modules", ".git", "target", "dist", "build", "temp", ".thumbnails",
];

/// 素材索引命令：扫描素材根目录（默认 E:\\media，可传参），按扩展名分类，
/// 返回文件名 / 大小 / 修改时间 / 分类，供知识库「素材库索引」使用。
#[tauri::command]
pub fn scan_assets(root: String, max_depth: Option<usize>) -> Result<Vec<AssetInfo>, String> {
    let depth = max_depth.unwrap_or(3).min(6);
    let root_path = Path::new(&root);
    if !root_path.is_dir() {
        return Err(format!("目录不存在: {root}"));
    }

    fn category_of(ext: &str) -> &'static str {
        match ext {
            "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "svg" | "tiff" | "ico" => "image",
            "mp4" | "mkv" | "avi" | "mov" | "webm" | "flv" | "wmv" | "ts" => "video",
            "mp3" | "wav" | "flac" | "m4a" | "ogg" | "aac" | "wma" => "audio",
            "blend" | "fbx" | "obj" | "stl" | "gltf" | "glb" | "dae" => "model",
            "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "md" | "txt" => "doc",
            _ => "other",
        }
    }

    let mut out: Vec<AssetInfo> = Vec::new();
    fn walk(dir: &Path, cur_depth: usize, max_depth: usize, out: &mut Vec<AssetInfo>) {
        if cur_depth > max_depth {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let name = p
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                if SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                walk(&p, cur_depth + 1, max_depth, out);
            } else if let Some(ext) = p.extension().and_then(|x| x.to_str()) {
                if ext.len() > 6 {
                    continue; // 跳过无意义长扩展名
                }
                if let Ok(meta) = p.metadata() {
                    let modified = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let name = p
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default();
                    out.push(AssetInfo {
                        name,
                        path: p.to_string_lossy().to_string(),
                        category: category_of(ext).to_string(),
                        ext: ext.to_string(),
                        size: meta.len(),
                        modified,
                    });
                }
            }
        }
    }
    walk(root_path, 0, depth, &mut out);

    // 保护：最多返回 2000 条，按修改时间倒序
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out.truncate(2000);
    Ok(out)
}
