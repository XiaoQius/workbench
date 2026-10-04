# WORKBENCH 个人工作台

Tauri 2 + Vue 3 桌面应用：把开发、运维、生活、学习、知识管理、灵感捕捉全部纳入一个**本地优先**（SQLite）的个人工作台。可选云同步实现多端实时同步；可选接入任意 OpenAI 兼容 / Anthropic / DeepSeek / Ollama 等 LLM 服务提供智能问答。

- 两维主题系统：配色（浅色/深色）× 风格（标准/粗野/科技）共 6 套组合
- 键盘驱动：全局命令面板（Ctrl+K）、模块热键（Ctrl+1..8）
- 应用内自动更新：检测新版本后直接下载并安装，无需离开应用
- 数据完全在本机 SQLite，云同步默认关闭；LLM API Key 仅存本机

![platform](https://img.shields.io/badge/platform-Windows%20x64-blue)
![version](https://img.shields.io/badge/version-0.1.7-green)
![license](https://img.shields.io/badge/license-MIT-orange)

## 下载与安装

前往 [Releases](https://github.com/XiaoQius/workbench/releases/latest) 下载 `WORKBENCH_<版本号>_x64_zh-CN.msi`，双击安装即可。

- 覆盖安装不丢数据：本地 SQLite 数据在安装目录之外，升级仅替换程序本体。
- 安装时若系统缺少 WebView2 运行时会自动从微软下载（需联网）。
- 已安装旧版的用户，应用启动时会自动检查更新，也可在「设置 → 更新与备份」中手动检查并**下载并安装**。

## 功能模块

| 路径 | 模块 | 热键 | 核心功能 |
| --- | --- | --- | --- |
| `#/` | 总览 | `Ctrl+1` | 数据区+操作区双分区、今日焦点、模块统计卡（可点跳转）、越界告警条、模块导航 |
| `#/workspace` | 工作台 | `Ctrl+2` | 工具启动台、Agent 会话台账与卡死检测 |
| `#/dev` | 开发 | `Ctrl+3` | 项目看板、任务列表、代码片段、Git 体检/提交、代码统计、环境变量 |
| `#/ops` | 运维 | `Ctrl+4` | 服务器/域名清单、健康探测、端口探活、代理检测、WSL、定时任务、备份健康验证、安全检查 |
| `#/life` | 生活 | `Ctrl+5` | 习惯打卡、极简记账、固定账单 |
| `#/study` | 学习 | `Ctrl+6` | 课程表、作业双轨（写完/提交）、笔记、闪卡、学习路径 |
| `#/knowledge` | 知识库 | `Ctrl+7` | 踩坑库、收藏链接、技能树、知识图谱、素材库索引 |
| `#/inspiration` | 灵感 | `Ctrl+8` / `g i` | 快速捕捉想法，`#标签` 自动解析、星标置顶、搜索过滤 |

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Tauri 2（Rust） |
| 前端 | Vue 3 + TypeScript + Vite |
| 状态 | Pinia |
| 路由 | Vue Router（hash 模式） |
| UI | Naive UI + UnoCSS，图标 @vicons/tabler |
| 数据层 | SQLite（tauri-plugin-sql；`drizzle/schema.ts` 作为类型源与迁移链蓝本） |
| 云同步 | 自建 relay（可选，REST + WebSocket 实时同步，41 张业务表） |
| 更新 | 云端版本端点 + GitHub Release 直链下载 + msiexec 拉起安装 |

## 目录结构

```
desktop/
├─ drizzle/schema.ts           # 表定义（类型源，42 张业务表）
├─ src
│  ├─ App.vue                  # 入口：SQLite 迁移链 + 主题/命令面板挂载
│  ├─ router/index.ts          # hash 路由：8 页面模块
│  ├─ stores/                  # theme（两维主题）/ palette（命令面板）/ ui（全局总线）
│  ├─ theme/                   # tokens.ts（设计 token 单一数据源）/ naive.ts / main.css
│  ├─ composables/             # useKeyboard（快捷键）/ useTauri（Rust 能力调用）/ llmClient
│  ├─ db/                      # client / migrate（幂等迁移链）/ repo（Repository 工厂）/ sync（云同步）
│  ├─ components/layout/       # AppShell（侧栏+顶栏）/ CommandPalette（Ctrl+K）
│  ├─ components/              # PageHeader / StatCard / ModalForm / SettingsPanel 等
│  └─ views/                   # Home / Workspace / Dev / Ops / Life / Study / Knowledge / Inspiration
└─ src-tauri
   ├─ src/commands/            # Rust 能力层：磁盘/端口/项目/进程/Git/LLM/代理/更新/备份 等
   ├─ tauri.conf.json          # 窗口 / bundle 配置（MSI，zh-CN）
   ├─ capabilities/            # 权限
   └─ Cargo.toml
```

## 数据层（SQLite）

启动时由 `src/db/migrate.ts` 幂等执行建表（`CREATE TABLE IF NOT EXISTS`）与建索引，覆盖：

- 跨模块：`tasks`（焦点标记）、`deadlines`（统一截止抽象）、`links`（实体关联）
- 开发：`projects`、`snippets`；工作台：`tools`、`agents`
- 运维：`servers`、`domains`、`backups`、运维流程/变更/安全检查/DNS 记录
- 生活：`habits` + `habitLogs`、`ledger`、固定账单；学习：`courses`、`assignments`、`notes`、闪卡、阅读队列
- 知识库：`pitfalls`、`resources`、技能树节点、学习路径
- 灵感：`inspirations`

所有表带软删除与版本列（`_ut` / `_del` / `_sv` / `_dev`），供云同步冲突合并使用。

## Rust 能力层（主要 commands）

| 分组 | 命令 |
| --- | --- |
| 本机状态 | `disk_space` / `port_usage` / `port_probe` / `proxy_detect` / `wsl_status` / `health_check` |
| 开发 | `scan_projects` / `git_status` / `git_log` / `code_stats` / `env_list` / `repo_health` / `deps_check` / `git_remote_info` / `git_init_repo` / `git_commit_all` / `git_gh_upload` / `open_path` |
| 工作台 | `list_installed_apps` / `resolve_shortcut` / `scan_agents` / `agent_workflow` / `schtasks_list` |
| 知识库 | `scan_assets` |
| AI | `llm_status` / `llm_chat`（Rust 原生 HTTP 转发，绕开 WebView CORS） |
| 系统 | `export_backup` / `export_backup_to` / `list_backups` / `read_backup` / `backup_verify` |
| 更新 | `check_update` / `download_update`（下载 MSI 并校验 OLE 魔数）/ `install_update`（msiexec /passive 拉起） |

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+K` / `Ctrl+/` | 命令面板（固定保留，可在其中执行记灵感、切主题等操作） |
| `Ctrl+1` ~ `Ctrl+8` | 切换 8 个页面模块（设置中可关闭） |
| `Ctrl+Shift+D` | 浅色 ⇄ 深色快捷切换（设置中可关闭） |
| `g` → `i` | 全局直达灵感页（非输入框聚焦时） |
| `Esc` | 关闭命令面板 |

## 云同步（可选）

默认纯本地。在「设置 → 云同步」注册/登录自建 relay 账户并开启后，全部业务表实时双向同步（REST 拉取 + WebSocket 推送），多设备间自动合并，离线改动重连后补推。relay 服务端代码不在本仓库，接口约定见 `src/db/sync.ts`。

## 开发与构建

前置：Node.js 18+、Rust（Tauri 2 要求 rustc 1.77.2+）、Windows 10/11（MSI 打包依赖 WebView2 bootstrapper）。

```bash
npm install
npm run tauri dev        # 开发（完整 Rust 能力）
npm run dev              # 仅预览前端（数据层降级为只读演示模式）
npm run build            # 前端构建（vue-tsc + vite）
npm run tauri build      # 生产打包（产出 MSI）
```

发布流程：更新 `package.json` / `src-tauri/Cargo.toml` / `tauri.conf.json` / `src/composables/useSettings.ts`（`APP_VERSION`）四处版本号 → `npm run tauri build` → 在 GitHub 打 tag 发 Release 并上传 MSI → 更新云端版本端点。

## 版本与更新信息

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

[MIT](LICENSE)
