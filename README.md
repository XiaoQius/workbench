---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: ce3f6a8aa735ea5c3cc2949b84b4125a_c9f122efbcc111f1b172525400248c00
    ReservedCode1: KGGs8DPBq76jnel5fQl779oP3pC0f4RZmL9speh+JcWHZa06/eS7KzFHROPNeKYQtGP9yysiIUZwrtT/XkxOUppZC+uhIevurh9aRIaeWkyf7yXmzrdx745bPHODy4Tv9WEBMOkiqYoPK/6+54Yb0Xyye3+pe7byPcY/aTg8EiC9/ef1AT0i3Mh9Gg0=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: ce3f6a8aa735ea5c3cc2949b84b4125a_c9f122efbcc111f1b172525400248c00
    ReservedCode2: KGGs8DPBq76jnel5fQl779oP3pC0f4RZmL9speh+JcWHZa06/eS7KzFHROPNeKYQtGP9yysiIUZwrtT/XkxOUppZC+uhIevurh9aRIaeWkyf7yXmzrdx745bPHODy4Tv9WEBMOkiqYoPK/6+54Yb0Xyye3+pe7byPcY/aTg8EiC9/ef1AT0i3Mh9Gg0=
---

# WORKBENCH 个人工作台

Tauri 2 + Vue 3 桌面应用：把开发、运维、生活、学习、知识库全部纳入一个本地优先（SQLite）的个人工作台。

现代极简视觉（浅 / 深双主题），键盘驱动，7 个页面模块 + 全局命令面板。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Tauri 2（Rust） |
| 前端 | Vue 3 + TypeScript + Vite |
| 状态 | Pinia |
| 路由 | Vue Router（hash 模式） |
| UI | Naive UI + UnoCSS |
| 图标 | @vicons/tabler |
| 数据层 | SQLite（tauri-plugin-sql，Drizzle schema 作为类型源与迁移链来源） |

## 目录结构

```
E:\CODEX\workbench
├─ drizzle\schema.ts          # Drizzle 表定义：跨模块表 + 各模块核心表（类型源）
├─ src
│  ├─ App.vue                 # 入口：初始化 SQLite 迁移链 + 主题/命令面板全局挂载
│  ├─ main.ts                 # 应用挂载
│  ├─ router\index.ts         # hash 路由：7 页面模块
│  ├─ stores\                # theme（双主题）/ palette（命令面板）/ data
│  ├─ theme\                 # tokens.ts（设计 token 单一数据源）/ naive.ts / main.css
│  ├─ composables\           # useKeyboard（Ctrl+K 等快捷键）/ useTauri（Rust 能力调用）
│  ├─ db\                    # client / migrate（幂等迁移链）/ repo（Repository 工厂）/ index
│  ├─ components\layout\    # AppShell（侧栏 + 顶栏）/ CommandPalette（Ctrl+K）
│  ├─ components\            # PageHeader / StatCard / EmptyState / ModalForm 等
│  └─ views\                 # Home / Workspace / Dev / Ops / Life / Study / Knowledge
└─ src-tauri
   ├─ src\commands\          # Rust 能力层：disk.rs（磁盘空间）/ port.rs（端口占用）/ project.rs（项目扫描）
   ├─ tauri.conf.json         # 窗口 / bundle 配置
   ├─ capabilities\          # 权限
   └─ Cargo.toml
```

## 页面模块（hash 路由）

| 路径 | 模块 | 一期核心功能 |
| --- | --- | --- |
| `#/` | 总览 | 今日焦点、模块统计、越界告警条（磁盘/截止）、模块导航 |
| `#/workspace` | 工作台 | 工具启动台、Agent 手动台账 |
| `#/dev` | 开发 | 项目看板、任务列表、代码片段 |
| `#/ops` | 运维 | 服务器清单、域名清单 |
| `#/life` | 生活 | 习惯打卡、极简记账 |
| `#/study` | 学习 | 课程表、作业双轨（写完/提交）、笔记 |
| `#/knowledge` | 知识库 | 踩坑库、收藏链接 |

## 数据层（SQLite）

启动时由 `src/db/migrate.ts` 幂等执行建表（`CREATE TABLE IF NOT EXISTS`），覆盖：

- 跨模块：`tasks`（焦点标记 focusDate）、`deadlines`（统一截止抽象）、`links`（实体关联）
- 开发：`projects`、`snippets`
- 工作台：`tools`、`agents`
- 运维：`servers`、`domains`、`backups`
- 生活：`habits` + `habitLogs`、`ledger`
- 学习：`courses`、`assignments`（双轨 status）、`notes`
- 知识库：`pitfalls`、`resources`

## Rust 能力层 commands

| 命令 | 功能 |
| --- | --- |
| `disk_space` | 各磁盘剩余空间 / 已用百分比 |
| `port_usage` | 指定端口占用情况 |
| `scan_projects` | 扫描目录下的开发项目（package.json / .git 特征） |

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+K` | 打开命令面板 |
| `Ctrl+1` ~ `Ctrl+7` | 切换 7 个页面模块 |
| `Ctrl+Shift+D` | 切换浅 / 深主题 |
| `Ctrl+/` | 打开命令面板（等价） |

## 启动方式

前置：Node.js 18+、Rust（Tauri 2 要求 rustc 1.77.2+）。

```bash
npm install
npm run tauri dev
```

仅预览前端（数据层降级为只读演示模式）：

```bash
npm run dev
```

生产构建：

```bash
npm run tauri build
```

## 一期范围说明

- 数据层为本地 SQLite，所有写操作需在 Tauri 环境（`npm run tauri dev`）下生效。
- 未内置 UI 的备份清单（`backups` 表）与实体关联（`links` 表）已建表，待二期接入。
*（内容由AI生成，仅供参考）*
