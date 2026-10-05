import { invoke } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'

export interface DiskInfo {
  mount: string
  total: number
  free: number
  used: number
  used_percent: number
}

export interface PortInfo {
  proto: string
  port: number
  state: string
  pid: number
  process: string
}

export interface ProjectInfo {
  name: string
  path: string
  techs: string[]
  has_git: boolean
  last_modified: number
}

export interface BackupInfo {
  name: string
  size: number
  modified: number
}

export interface LlmStatus {
  configured: boolean
  provider: string
}

export interface AgentSessionInfo {
  vendor: string
  name: string
  session_file: string
  last_activity: number
  age_secs: number
  stalled: boolean
  status: string // running | stalled
}

export interface GitStatus {
  repo: string
  branch: string
  clean: boolean
  changed_files: number
  ahead: number
  behind: number
  stash_count: number
}

export interface AssetInfo {
  name: string
  path: string
  category: string // image | video | audio | model | doc | other
  ext: string
  size: number
  modified: number
}

export interface HealthResult {
  target: string
  ok: boolean
  latency_ms: number
  detail: string
}

export interface ProxyInfo {
  enabled: boolean
  server: string
  auto_config: string
  port7890_ok: boolean
}

/** 磁盘空间（Rust 命令） */
export function diskSpace(): Promise<DiskInfo[]> {
  return invoke<DiskInfo[]>('disk_space')
}

/** 端口占用（Rust 命令） */
export function portUsage(): Promise<PortInfo[]> {
  return invoke<PortInfo[]>('port_usage')
}

/**
 * 项目扫描（Rust 命令）。
 * root 省略时默认用户主目录：原先硬编码作者本机的 'E:\\CODEX'，
 * 既暴露了个人磁盘结构（源码在公开仓库里），别的机器上一个都不命中。
 */
export async function scanProjects(root?: string): Promise<ProjectInfo[]> {
  const start = root ?? (await homeDir()).replace(/[\\/]+$/, '')
  return invoke<ProjectInfo[]>('scan_projects', { root: start, maxDepth: 3 })
}

/** 数据导出（系统底座：Rust 命令） */
export function exportBackup(json: string): Promise<string> {
  return invoke<string>('export_backup', { json })
}

/** F-SYS-07 Git 数据同步：导出备份 JSON 到用户指定目录（安全校验见 Rust 端） */
export function exportBackupTo(path: string, json: string): Promise<string> {
  return invoke<string>('export_backup_to', { path, json })
}

/** 备份列表（系统底座：Rust 命令） */
export function listBackups(): Promise<BackupInfo[]> {
  return invoke<BackupInfo[]>('list_backups')
}

/** 读取备份内容（系统底座：Rust 命令） */
export function readBackup(name: string): Promise<string> {
  return invoke<string>('read_backup', { name })
}

/** 智能层状态检测（Rust 命令） */
export function llmStatus(): Promise<LlmStatus> {
  return invoke<LlmStatus>('llm_status')
}

/** Agent 多源会话扫描 + 卡死判定（Rust 命令，F-AGT-01/02） */
export function scanAgents(): Promise<AgentSessionInfo[]> {
  return invoke<AgentSessionInfo[]>('scan_agents')
}

/** Git 清洁度检查（Rust 命令，F-DEV-03） */
export function gitStatus(repoPath: string): Promise<GitStatus> {
  return invoke<GitStatus>('git_status', { repoPath })
}

/** 素材库索引（Rust 命令，F-KNW-07） */
export function scanAssets(root: string, maxDepth = 3): Promise<AssetInfo[]> {
  return invoke<AssetInfo[]>('scan_assets', { root, maxDepth })
}

/** 健康探测（Rust 命令，F-OPS-07） */
export function healthCheck(target: string): Promise<HealthResult> {
  return invoke<HealthResult>('health_check', { target })
}

/** 代理状态检测（Rust 命令，F-OPS-10） */
export function proxyDetect(): Promise<ProxyInfo> {
  return invoke<ProxyInfo>('proxy_detect')
}

export interface PortProbeResult {
  port: number
  open: boolean
  latency_ms: number
}

export interface WslDistro {
  name: string
  state: string
  version: string
}

export interface ScheduledTask {
  task_name: string
  next_run: string
  status: string
  last_run: string
  last_result: string
}

/** 端口批量在线探活（Rust 命令，F-LP-03） */
export function portProbe(host: string, ports: number[]): Promise<PortProbeResult[]> {
  return invoke<PortProbeResult[]>('port_probe', { host, ports })
}

/** WSL 发行版状态（Rust 命令，F-OPS-11） */
export function wslStatus(): Promise<WslDistro[]> {
  return invoke<WslDistro[]>('wsl_status')
}

/** 定时任务台账（Rust 命令，F-DEV-10） */
export function schtasksList(): Promise<ScheduledTask[]> {
  return invoke<ScheduledTask[]>('schtasks_list')
}

/** 备份健康验证（Rust 命令，F-OPS-18） */
export interface BackupVerifyInfo {
  name: string
  size: number
  modified: number
  valid: boolean
  tables: number
  records: number
  error: string | null
}
export function backupVerify(): Promise<BackupVerifyInfo[]> {
  return invoke<BackupVerifyInfo[]>('backup_verify')
}

/** 智能体工作流拆解（Rust 命令，F-AGT-06~18） */
export interface AgentSubTask {
  seq: number
  title: string
  action: string
  acceptance: string
}
export interface AgentWorkflowResult {
  goal: string
  sub_tasks: AgentSubTask[]
  estimated_effort: string
  quality_checks: string[]
  risks: string[]
  self_heal_hints: string[]
}
export function agentWorkflow(goal: string): Promise<AgentWorkflowResult> {
  return invoke<AgentWorkflowResult>('agent_workflow', { goal })
}

// ---- F-DEV 系列新命令封装 ----

export interface GitCommitInfo {
  hash: string
  short_hash: string
  author: string
  date: string
  message: string
}

export interface LangStat {
  lang: string
  files: number
  lines: number
}

export interface RepoHealth {
  repo: string
  has_git: boolean
  branch: string
  dirty_files: number
  ahead: number
  behind: number
  last_commit_at: string
  last_commit_msg: string
  has_cargo: boolean
  has_package_json: boolean
  has_readme: boolean
  has_ci: boolean
  size_mb: number
  file_count: number
}

/** 一键打开项目/路径（Rust 命令，F-DEV-04） */
export function openPath(path: string): Promise<string> {
  return invoke<string>('open_path', { path })
}

/** 启动本机程序（exe 路径 + 可选参数），工具启动台 cmd 类型使用 */
export function launchApp(target: string, args?: string): Promise<string> {
  return invoke<string>('launch_app', { target, args: args ?? null })
}

/** Git 提交历史（Rust 命令，F-DEV-15/17 Git 操作可视化） */
export function gitLog(repoPath: string, limit?: number): Promise<GitCommitInfo[]> {
  return invoke<GitCommitInfo[]>('git_log', { repoPath, limit })
}

/** 代码统计（Rust 命令，F-DEV-16 代码统计） */
export function codeStats(root: string): Promise<LangStat[]> {
  return invoke<LangStat[]>('code_stats', { root })
}

/** 环境变量清单（Rust 命令，F-DEV-11） */
export function envList(): Promise<Array<[string, string]>> {
  return invoke<Array<[string, string]>>('env_list')
}

/** 仓库体检（Rust 命令，F-DEV-15） */
export function repoHealth(repoPath: string): Promise<RepoHealth> {
  return invoke<RepoHealth>('repo_health', { repoPath })
}

/** 依赖检查（Rust 命令，F-DEV-16） */
export function depsCheck(repoPath: string): Promise<DepCheckItem[]> {
  return invoke<DepCheckItem[]>('deps_check', { repoPath })
}

export interface DepCheckItem {
  name: string
  version: string
  kind: string
}

// ---- 工作台升级：本机程序识别 / 更新检查 / Git 版本管理 ----

export interface InstalledApp {
  name: string
  exe_path: string | null
  lnk_path: string | null
  source: string // "start-menu" | "registry"
}

/** 自动识别本机已安装程序（开始菜单 + 注册表 Uninstall） */
export function listInstalledApps(): Promise<InstalledApp[]> {
  return invoke<InstalledApp[]>('list_installed_apps')
}

/** 解析 .lnk 快捷方式目标 exe 路径 */
export function resolveShortcut(lnkPath: string): Promise<string | null> {
  return invoke<string | null>('resolve_shortcut', { lnkPath })
}

export interface UpdateInfo {
  current: string
  latest: string | null
  has_update: boolean
  release_url: string | null
}

/** 检查更新（update_url 为 owner/repo 走 GitHub Releases，否则自定义端点） */
export function checkUpdate(updateUrl: string, currentVersion: string): Promise<UpdateInfo> {
  return invoke<UpdateInfo>('check_update', { updateUrl, currentVersion })
}

/** 应用内更新：下载 MSI 安装包到本地临时目录，返回文件路径（仅 Tauri 环境可用） */
export function downloadUpdate(url: string, version: string): Promise<string> {
  return invoke<string>('download_update', { url, version })
}

/** 拉起 msiexec 安装已下载的安装包（passive 进度条，无需交互） */
export function installUpdate(filePath: string): Promise<string> {
  return invoke<string>('install_update', { filePath })
}

export interface GitRemoteInfo {
  repo: string
  is_repo: boolean
  remote: string | null
  remote_url: string | null
  branch: string
  changed_files: number
}

/** Git 版本管理总览：是否仓库 / 远端 / 分支 / 未提交数 */
export function gitRemoteInfo(repoPath: string): Promise<GitRemoteInfo> {
  return invoke<GitRemoteInfo>('git_remote_info', { repoPath })
}

/** 一键 git init + 首次提交 */
export function gitInitRepo(repoPath: string): Promise<string> {
  return invoke<string>('git_init_repo', { repoPath })
}

/** 提交全部改动 */
export function gitCommitAll(repoPath: string, message: string): Promise<string> {
  return invoke<string>('git_commit_all', { repoPath, message })
}

/** gh CLI 上传 GitHub（可选私有仓库） */
export function gitGhUpload(repoPath: string, repoName: string, isPrivate: boolean): Promise<string> {
  return invoke<string>('git_gh_upload', { repoPath, repoName, isPrivate })
}
