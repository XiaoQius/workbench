use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize)]
pub struct AgentSessionInfo {
    pub vendor: String,
    pub name: String,
    pub session_file: String,
    pub last_activity: u64,
    pub age_secs: u64,
    pub stalled: bool,
    pub status: String, // running | stalled
}

#[derive(Serialize)]
pub struct AgentSubTask {
    pub seq: usize,
    pub title: String,
    pub action: String,
    pub acceptance: String,
}

#[derive(Serialize)]
pub struct AgentWorkflowResult {
    pub goal: String,
    pub sub_tasks: Vec<AgentSubTask>,
    pub estimated_effort: String,
    pub quality_checks: Vec<String>,
    pub risks: Vec<String>,
    pub self_heal_hints: Vec<String>,
}

/// 智能体工作流深度项（F-AGT-06~18）：
/// 基于目标文本做规则式任务拆解、执行计划、质量评估、风险识别与自愈提示。
/// 不依赖 LLM，纯本地可运行，前端可将结果接入 Workspace 会话卡片。
#[tauri::command]
pub fn agent_workflow(goal: String) -> AgentWorkflowResult {
    let cleaned = goal.trim().to_string();
    let _lowered = cleaned.to_lowercase();

    // 按常见分隔符拆解目标片段
    let mut chunks: Vec<String> = cleaned
        .split(|c: char| c == '，' || c == ',' || c == '。' || c == '；' || c == ';' || c == '、')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && s.chars().count() > 3)
        .map(|s| s.to_string())
        .collect();
    if chunks.len() < 2 {
        chunks = vec![
            format!("明确 {cleaned} 的目标范围与验收标准"),
            format!("设计 {cleaned} 的执行方案与依赖清单"),
            format!("执行 {cleaned} 的核心步骤并记录进展"),
            format!("验证 {cleaned} 的交付结果并复盘归档"),
        ];
    }
    chunks.truncate(8);

    let sub_tasks: Vec<AgentSubTask> = chunks
        .iter()
        .enumerate()
        .map(|(i, c)| AgentSubTask {
            seq: i + 1,
            title: format!("步骤 {}：{}", i + 1, c),
            action: format!("围绕「{}」执行最小可验证动作并输出中间产物", c),
            acceptance: if i == chunks.len() - 1 {
                format!("「{}」交付完整，满足验收标准并归档", c)
            } else {
                format!("「{}」输出可被下一步引用的结果", c)
            },
        })
        .collect();

    let estimated_effort = if chunks.len() <= 2 {
        "low".to_string()
    } else if chunks.len() <= 5 {
        "medium".to_string()
    } else {
        "high".to_string()
    };

    let quality_checks = vec![
        "完整性：所有子任务均有明确动作与验收标准".to_string(),
        "可执行性：每步均可独立推进，不依赖未定义的输入".to_string(),
        "依赖有序：步骤间无循环引用，可断点续传".to_string(),
        "结果可测：验收标准可用客观证据验证".to_string(),
        "可追溯：中间产物按时间线留痕，便于复盘".to_string(),
    ];

    let mut risks = Vec::new();
    if cleaned.contains("迁移") || cleaned.contains("重构") || cleaned.contains("升级") {
        risks.push("涉及存量变更，需先备份并准备回滚方案".to_string());
    }
    if cleaned.contains("删除") || cleaned.contains("清理") {
        risks.push("含删除/清理语义，必须先确认范围并做可逆操作".to_string());
    }
    if cleaned.contains("接入") || cleaned.contains("集成") || cleaned.contains("api") {
        risks.push("存在外部依赖，需验证凭据与接口可用性".to_string());
    }
    risks.push(format!("任务规模评估为 {}，若单轮上下文不足应拆分执行", estimated_effort));

    let self_heal_hints = vec![
        "失败重试：相同错误最多重试 2 次，切换参数或方案后再试".to_string(),
        "断点续传：从最近成功的子任务序号继续，不重复已完成动作".to_string(),
        "日志留痕：每步写入执行日志，异常时按日志定位失败节点".to_string(),
        "回滚预案：破坏性操作前导出快照，异常时优先恢复".to_string(),
    ];

    AgentWorkflowResult {
        goal: cleaned,
        sub_tasks,
        estimated_effort,
        quality_checks,
        risks,
        self_heal_hints,
    }
}

/// 卡死判定阈值：运行中但文件 mtime 超 5 分钟未更新 → STALLED
const STALLED_THRESHOLD_SECS: u64 = 300;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
}

/// 在目录内递归（最多 depth 层）收集所有 .jsonl 会话文件，并返回其 mtime 秒数。
fn collect_session_files(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, u64)>) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_session_files(&p, depth + 1, out);
        } else if p.extension().and_then(|x| x.to_str()) == Some("jsonl") {
            if let Ok(meta) = p.metadata() {
                if let Ok(t) = meta.modified() {
                    if let Ok(d) = t.duration_since(UNIX_EPOCH) {
                        out.push((p.clone(), d.as_secs()));
                    }
                }
            }
        }
    }
}

/// Agent 多源会话扫描命令：
/// 读取 Claude Code / Codex / DSH / MiMoCode / CodeBuddy 等本机会话目录，
/// 按会话文件 mtime 判定是否卡死（running 但超过 5 分钟无输出 → STALLED）。
#[tauri::command]
pub fn scan_agents() -> Vec<AgentSessionInfo> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };

    // vendor -> 会话根目录（目录不存在则跳过）
    let candidates: &[(&str, PathBuf)] = &[
        ("Claude Code", home.join(".claude").join("projects")),
        ("Codex", home.join(".codex").join("sessions")),
        ("DSH", home.join(".dsh")),
        ("MiMoCode", home.join(".mimocode")),
        ("CodeBuddy", home.join(".codebuddy")),
    ];

    let now = now_secs();
    let mut result: Vec<AgentSessionInfo> = Vec::new();
    for (vendor, root) in candidates {
        if !root.is_dir() {
            continue;
        }
        let mut files: Vec<(PathBuf, u64)> = Vec::new();
        collect_session_files(root, 0, &mut files);
        files.sort_by(|a, b| b.1.cmp(&a.1));
        // 每个 vendor 最多取最近 8 个会话，避免界面过载
        for (path, mtime) in files.into_iter().take(8) {
            let age = now.saturating_sub(mtime);
            let stalled = age > STALLED_THRESHOLD_SECS;
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            result.push(AgentSessionInfo {
                vendor: vendor.to_string(),
                name,
                session_file: path.to_string_lossy().to_string(),
                last_activity: mtime,
                age_secs: age,
                stalled,
                status: if stalled { "stalled".to_string() } else { "running".to_string() },
            });
        }
    }
    result
}
