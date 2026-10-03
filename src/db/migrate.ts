import { exec } from './client'

// ============================================================
// 迁移链 v1：幂等建表（CREATE TABLE IF NOT EXISTS）
// 与 drizzle/schema.ts 保持一致；后续版本按序追加到数组末尾。
// 启动时由 App.vue 调用 initDb() 全量执行。
// ============================================================

const MIGRATIONS_V1: string[] = [
  // ---- 跨模块表 ----
  `CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'dev',
    type TEXT NOT NULL DEFAULT 'task',
    priority TEXT NOT NULL DEFAULT 'medium',
    projectId INTEGER,
    status TEXT NOT NULL DEFAULT 'todo',
    dueDate TEXT,
    focusDate TEXT,
    note TEXT,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS deadlines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    dueDate TEXT NOT NULL,
    source TEXT NOT NULL,
    sourceId INTEGER,
    status TEXT NOT NULL DEFAULT 'open',
    remindDays INTEGER NOT NULL DEFAULT 3,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fromType TEXT NOT NULL,
    fromId INTEGER NOT NULL,
    toType TEXT NOT NULL,
    toId INTEGER NOT NULL,
    label TEXT,
    createdAt TEXT
  )`,
  // ---- 开发 DEV ----
  `CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    techStack TEXT,
    repoPath TEXT,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS snippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'text',
    code TEXT NOT NULL,
    description TEXT,
    tags TEXT,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  // ---- 工作台 WORKSPACE ----
  `CREATE TABLE IF NOT EXISTS tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    launchType TEXT NOT NULL DEFAULT 'protocol',
    target TEXT NOT NULL,
    port INTEGER,
    note TEXT,
    docUrl TEXT,
    hitCount INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    vendor TEXT,
    task TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    startedAt TEXT,
    note TEXT,
    createdAt TEXT
  )`,
  // ---- 运维 OPS ----
  `CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    purpose TEXT,
    vendor TEXT,
    region TEXT,
    ip TEXT,
    sshPort INTEGER NOT NULL DEFAULT 22,
    user TEXT,
    config TEXT,
    monthlyCost REAL,
    expireDate TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    registrar TEXT,
    dnsProvider TEXT,
    expireDate TEXT,
    serverId INTEGER,
    sslExpireDate TEXT,
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT,
    lastBackupAt TEXT,
    verified INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    createdAt TEXT
  )`,
  // ---- 生活 LIFE ----
  `CREATE TABLE IF NOT EXISTS habits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#059669',
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS habitLogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    habitId INTEGER NOT NULL,
    date TEXT NOT NULL,
    createdAt TEXT,
    UNIQUE(habitId, date)
  )`,
  `CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'expense',
    amount REAL NOT NULL,
    category TEXT NOT NULL DEFAULT '其他',
    note TEXT,
    date TEXT NOT NULL,
    createdAt TEXT
  )`,
  // 番茄钟（F-LIFE-04）
  `CREATE TABLE IF NOT EXISTS pomodoros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task TEXT,
    minutes INTEGER NOT NULL DEFAULT 25,
    startedAt TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT
  )`,
  // 健康记录（F-LIFE-06）
  `CREATE TABLE IF NOT EXISTS healthLogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    sleepHours REAL,
    exerciseMin INTEGER,
    mood INTEGER,
    weight REAL,
    note TEXT,
    createdAt TEXT
  )`,
  // ---- 学习 STUDY ----
  `CREATE TABLE IF NOT EXISTS courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    weekday TEXT NOT NULL DEFAULT '一',
    startPeriod INTEGER NOT NULL DEFAULT 1,
    endPeriod INTEGER NOT NULL DEFAULT 2,
    location TEXT,
    teacher TEXT,
    weeks TEXT,
    note TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    courseId INTEGER,
    title TEXT NOT NULL,
    dueDate TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    tags TEXT,
    courseId INTEGER,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  // ---- 知识库 KNOWLEDGE ----
  `CREATE TABLE IF NOT EXISTS pitfalls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '其他',
    problem TEXT,
    solution TEXT,
    tags TEXT,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'favorite',
    note TEXT,
    createdAt TEXT
  )`,
  // ---- 运维台账 OPS REGISTRY ----
  `CREATE TABLE IF NOT EXISTS opsFlows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    metric TEXT NOT NULL DEFAULT 'qps',
    threshold REAL NOT NULL DEFAULT 0,
    current REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ok',
    note TEXT,
    updatedAt TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS opsChanges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    env TEXT NOT NULL DEFAULT 'prod',
    category TEXT NOT NULL DEFAULT 'config',
    detail TEXT,
    operator TEXT,
    changedAt TEXT,
    status TEXT NOT NULL DEFAULT 'done',
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS opsSecChecks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    severity TEXT NOT NULL DEFAULT 'low',
    result TEXT NOT NULL DEFAULT 'pass',
    detail TEXT,
    checkedAt TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS opsSecrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    provider TEXT,
    account TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    expiresAt TEXT,
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS opsDns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    recordType TEXT NOT NULL DEFAULT 'A',
    host TEXT NOT NULL DEFAULT '@',
    value TEXT NOT NULL,
    ttl INTEGER NOT NULL DEFAULT 600,
    status TEXT NOT NULL DEFAULT 'active',
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS deployments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    env TEXT NOT NULL DEFAULT 'prod',
    version TEXT,
    status TEXT NOT NULL DEFAULT 'success',
    deployedAt TEXT,
    operator TEXT,
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS envVars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    value TEXT,
    scope TEXT NOT NULL DEFAULT 'user',
    note TEXT,
    updatedAt TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS techDebts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'tech',
    severity TEXT NOT NULL DEFAULT 'medium',
    project TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    detail TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS cmdSnippets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'shell',
    command TEXT NOT NULL,
    note TEXT,
    hitCount INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    context TEXT,
    decision TEXT,
    alternatives TEXT,
    status TEXT NOT NULL DEFAULT 'proposed',
    decidedAt TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS skillTree (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parentId INTEGER,
    level INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'todo',
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS learningPaths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    goal TEXT,
    step TEXT NOT NULL DEFAULT '1',
    resource TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    orderIndex INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS threeDProjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tool TEXT,
    category TEXT NOT NULL DEFAULT 'model',
    status TEXT NOT NULL DEFAULT 'planning',
    path TEXT,
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS portfolios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'code',
    url TEXT,
    path TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS contentCalendars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'other',
    plannedAt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS fixedBills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT '订阅',
    cycle TEXT NOT NULL DEFAULT 'monthly',
    dueDay INTEGER NOT NULL DEFAULT 1,
    payMethod TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS grades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    courseId INTEGER,
    courseName TEXT NOT NULL,
    examType TEXT NOT NULL DEFAULT '期中',
    score REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 100,
    weight REAL NOT NULL DEFAULT 1,
    date TEXT,
    note TEXT,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS flashcards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    deck TEXT NOT NULL DEFAULT '默认',
    level INTEGER NOT NULL DEFAULT 0,
    dueDate TEXT,
    lastReview TEXT,
    reviewCount INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS readQueue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    category TEXT,
    url TEXT,
    status TEXT NOT NULL DEFAULT 'queue',
    priority INTEGER NOT NULL DEFAULT 1,
    totalPages INTEGER NOT NULL DEFAULT 0,
    currentPage INTEGER NOT NULL DEFAULT 0,
    rating INTEGER,
    note TEXT,
    addedAt TEXT,
    finishedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS feynmanLogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    explanation TEXT NOT NULL,
    gap TEXT,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    createdAt TEXT
  )`,
  // ---- 灵感 INSPIRATION ----
  `CREATE TABLE IF NOT EXISTS inspirations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    tags TEXT,
    mood TEXT,
    starred INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT,
    updatedAt TEXT
  )`,
  // ---- 个人档案 PROFILE（跨端头像同步，单行语义）----
  // 固定单行 id=1（而非文本 'me'）：推拉引擎整条链路都按整数主键设计——
  // _sync_state.rowId 声明 INTEGER，applyRemoteBatch 拼 `WHERE id = ${rowId}` 不带引号，
  // relay 推送用 Number(id)>0 判断是否带服务端 id、新行由 AUTOINCREMENT 分配。
  // 文本主键会在上述拼接处产生 SQL 错误并卡死拉取游标，故保持整数 1。
  // 同步列(user_id/_ut/_del/_dev/_sv)与其余业务表一致：本地不建列，
  // 桌面端记账在 _sync_state，relay 启动时由 db.js 统一 ALTER 追加。
  `CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    avatarText TEXT,
    avatarColor TEXT,
    avatarImg TEXT,
    updatedAt INTEGER
  )`,
]

// 索引：此前全库无索引，所有过滤/排序都是全表扫描，数据增长后查询与同步线性变慢。
// 这里只补同步热路径与列表常用过滤列，均为幂等。
const INDEXES_V1: string[] = [
  // 同步热路径：按 serverId 反查本地行、按 pending 取待推送（sync.ts 每次同步必查）
  `CREATE INDEX IF NOT EXISTS idx_sync_state_server ON _sync_state(tableName, serverId)`,
  `CREATE INDEX IF NOT EXISTS idx_sync_state_pending ON _sync_state(tableName, pending)`,
  // 列表与统计常用过滤列
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, dueDate)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_scope ON tasks(scope)`,
  `CREATE INDEX IF NOT EXISTS idx_deadlines_status ON deadlines(status, dueDate)`,
  `CREATE INDEX IF NOT EXISTS idx_habitlogs_habit ON habitLogs(habitId, date)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger(date)`,
  `CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status, dueDate)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updatedAt)`,
  `CREATE INDEX IF NOT EXISTS idx_snippets_updated ON snippets(updatedAt)`,
  `CREATE INDEX IF NOT EXISTS idx_domains_expire ON domains(expireDate)`,
  `CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status)`,
  `CREATE INDEX IF NOT EXISTS idx_flashcards_due ON flashcards(deck, dueDate)`,
  `CREATE INDEX IF NOT EXISTS idx_readqueue_status ON readQueue(status)`,
  `CREATE INDEX IF NOT EXISTS idx_cmd_snippets_hit ON cmdSnippets(hitCount)`,
  `CREATE INDEX IF NOT EXISTS idx_tools_hit ON tools(hitCount)`,
  `CREATE INDEX IF NOT EXISTS idx_inspirations_created ON inspirations(createdAt)`,
]

/**
 * 单条 SQL 的失败信息。
 */
export interface BatchFailure {
  /** 失败语句在批次中的下标 */
  index: number
  /** 语句前 200 字符，便于定位 */
  sql: string
  error: string
}

/**
 * 批量执行 SQL 脚本：优先整批提交以减少 IPC 往返；
 * 若驱动不接受多语句，自动降级为逐条执行（保证迁移不会因优化而失败）。
 *
 * 返回失败清单（原先直接吞掉）。这一点对同步至关重要：
 * 同步引擎用它判断「本页是否完整落库」，只有全部成功才允许推进游标。
 * 否则一条约束冲突就会让那一行永远不再被拉取，两端静默分叉。
 * 迁移链本身不关心返回值，行为与之前一致。
 */
export async function runBatch(sqls: string[]): Promise<BatchFailure[]> {
  const failures: BatchFailure[] = []
  try {
    await exec(sqls.join(';\n'))
    return failures
  } catch {
    // 整批失败：退化为逐条执行，把真正出错的那几条挑出来
    for (let i = 0; i < sqls.length; i++) {
      const sql = sqls[i]
      try {
        await exec(sql)
      } catch (e) {
        failures.push({ index: i, sql: sql.slice(0, 200), error: e instanceof Error ? e.message : String(e) })
      }
    }
    return failures
  }
}

/**
 * 执行全部迁移（幂等）。
 * 建表与建索引各合成一条多语句脚本，避免 41+ 次串行 IPC 往返拖慢启动。
 */
export async function initDb(): Promise<void> {
  await runBatch(MIGRATIONS_V1)
  // 索引含 _sync_state 相关项，该表由 initSyncSchema 创建；此处失败不影响主流程
  try {
    await runBatch(INDEXES_V1)
  } catch {
    /* initSyncSchema 后再由 ensureSyncIndexes 补建 */
  }
}

/** 同步元数据表就绪后补建其索引（initSyncSchema 之后调用） */
export async function ensureSyncIndexes(): Promise<void> {
  await runBatch(INDEXES_V1)
}

export const migrationVersion = 1
