import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ============================================================
// WORKBENCH 数据层 Schema（Drizzle 定义）
// 运行时建表由 src/db/migrate.ts 的幂等迁移链负责（plugin-sql 直接执行 SQL），
// 此处作为：① 迁移链（drizzle-kit generate）唯一数据源；② 前端 TypeScript 类型源。
// 列名统一 camelCase，与前端 repo 层零转换。
// ============================================================

// ---------- 跨模块共享表 ----------

/** 任务（scope 区分 dev / life / study，跨模块统一） */
export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  scope: text('scope').notNull().default('dev'), // dev | life | study
  type: text('type').notNull().default('task'), // task | bug | feature | chore | study | life
  priority: text('priority').notNull().default('medium'), // low | medium | high | urgent
  projectId: integer('projectId'),
  status: text('status').notNull().default('todo'), // todo | doing | done
  dueDate: text('dueDate'),
  focusDate: text('focusDate'), // 今日焦点标记（yyyy-MM-dd）
  note: text('note'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
})
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert

/** 截止日期（作业 / 服务器续费 / 域名到期 / 考试等统一抽象，带 source） */
export const deadlines = sqliteTable('deadlines', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  dueDate: text('dueDate').notNull(),
  source: text('source').notNull(), // server | domain | course | assignment | ssl | other
  sourceId: integer('sourceId'),
  status: text('status').notNull().default('open'), // open | closed
  remindDays: integer('remindDays').notNull().default(3),
  createdAt: text('createdAt'),
})
export type Deadline = typeof deadlines.$inferSelect
export type NewDeadline = typeof deadlines.$inferInsert

/** 实体双向链接（任务/项目/坑/笔记/决策互相关联） */
export const links = sqliteTable('links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fromType: text('fromType').notNull(),
  fromId: integer('fromId').notNull(),
  toType: text('toType').notNull(),
  toId: integer('toId').notNull(),
  label: text('label'),
  createdAt: text('createdAt'),
})
export type Link = typeof links.$inferSelect
export type NewLink = typeof links.$inferInsert

// ---------- 开发 DEV ----------

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'), // active | paused | archived
  techStack: text('techStack'),
  repoPath: text('repoPath'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
})
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert

export const snippets = sqliteTable('snippets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  language: text('language').notNull().default('text'),
  code: text('code').notNull(),
  description: text('description'),
  tags: text('tags'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
})
export type Snippet = typeof snippets.$inferSelect
export type NewSnippet = typeof snippets.$inferInsert

// ---------- 工作台 WORKSPACE ----------

export const tools = sqliteTable('tools', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  category: text('category').notNull().default('other'), // agent | editor | terminal | runtime | design | ops | local | online | other
  launchType: text('launchType').notNull().default('protocol'), // protocol | url | cmd
  target: text('target').notNull(),
  port: integer('port'),
  note: text('note'),
  docUrl: text('docUrl'),
  hitCount: integer('hitCount').notNull().default(0),
  createdAt: text('createdAt'),
})
export type Tool = typeof tools.$inferSelect
export type NewTool = typeof tools.$inferInsert

export const agents = sqliteTable('agents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  vendor: text('vendor'),
  task: text('task'),
  status: text('status').notNull().default('idle'), // idle | running | stalled | done
  startedAt: text('startedAt'),
  note: text('note'),
  createdAt: text('createdAt'),
})
export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert

// ---------- 运维 OPS ----------

export const servers = sqliteTable('servers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  purpose: text('purpose'),
  vendor: text('vendor'),
  region: text('region'),
  ip: text('ip'),
  sshPort: integer('sshPort').notNull().default(22),
  user: text('user'),
  config: text('config'),
  monthlyCost: real('monthlyCost'),
  expireDate: text('expireDate'),
  status: text('status').notNull().default('active'), // active | stopped | expiring
  note: text('note'),
  createdAt: text('createdAt'),
})
export type Server = typeof servers.$inferSelect
export type NewServer = typeof servers.$inferInsert

export const domains = sqliteTable('domains', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  registrar: text('registrar'),
  dnsProvider: text('dnsProvider'),
  expireDate: text('expireDate'),
  serverId: integer('serverId'), // 域名↔服务器关联
  sslExpireDate: text('sslExpireDate'),
  note: text('note'),
  createdAt: text('createdAt'),
})
export type Domain = typeof domains.$inferSelect
export type NewDomain = typeof domains.$inferInsert

export const backups = sqliteTable('backups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  location: text('location'),
  lastBackupAt: text('lastBackupAt'),
  verified: integer('verified').notNull().default(0), // 0 | 1
  note: text('note'),
  createdAt: text('createdAt'),
})
export type Backup = typeof backups.$inferSelect
export type NewBackup = typeof backups.$inferInsert

// ---------- 生活 LIFE ----------

export const habits = sqliteTable('habits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  color: text('color').notNull().default('#059669'),
  createdAt: text('createdAt'),
})
export type Habit = typeof habits.$inferSelect
export type NewHabit = typeof habits.$inferInsert

export const habitLogs = sqliteTable('habitLogs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  habitId: integer('habitId').notNull(),
  date: text('date').notNull(), // yyyy-MM-dd
  createdAt: text('createdAt'),
})
export type HabitLog = typeof habitLogs.$inferSelect
export type NewHabitLog = typeof habitLogs.$inferInsert

export const ledger = sqliteTable('ledger', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull().default('expense'), // income | expense
  amount: real('amount').notNull(),
  category: text('category').notNull().default('其他'),
  note: text('note'),
  date: text('date').notNull(), // yyyy-MM-dd
  createdAt: text('createdAt'),
})
export type LedgerEntry = typeof ledger.$inferSelect
export type NewLedgerEntry = typeof ledger.$inferInsert

// 番茄钟（F-LIFE-04）：专注计时记录，前端实时倒计时，结束时写库
export const pomodoros = sqliteTable('pomodoros', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  task: text('task'),
  minutes: integer('minutes').notNull().default(25),
  startedAt: text('startedAt'), // yyyy-MM-dd HH:mm:ss
  completed: integer('completed').notNull().default(0), // 0=进行中 1=已完成
  createdAt: text('createdAt'),
})
export type Pomodoro = typeof pomodoros.$inferSelect
export type NewPomodoro = typeof pomodoros.$inferInsert

// 健康记录（F-LIFE-06）：睡眠/运动/心情/体重打卡
export const healthLogs = sqliteTable('healthLogs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(), // yyyy-MM-dd
  sleepHours: real('sleepHours'),
  exerciseMin: integer('exerciseMin'),
  mood: integer('mood'), // 1~5
  weight: real('weight'),
  note: text('note'),
  createdAt: text('createdAt'),
})
export type HealthLog = typeof healthLogs.$inferSelect
export type NewHealthLog = typeof healthLogs.$inferInsert

// ---------- 学习 STUDY ----------

export const courses = sqliteTable('courses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  weekday: text('weekday').notNull().default('一'), // 一 ~ 日
  startPeriod: integer('startPeriod').notNull().default(1), // 起始节
  endPeriod: integer('endPeriod').notNull().default(2), // 结束节
  location: text('location'),
  teacher: text('teacher'),
  weeks: text('weeks'), // 周次，如 "1-16"
  note: text('note'),
})
export type Course = typeof courses.$inferSelect
export type NewCourse = typeof courses.$inferInsert

export const assignments = sqliteTable('assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('courseId'),
  title: text('title').notNull(),
  dueDate: text('dueDate'),
  status: text('status').notNull().default('todo'), // 双轨：todo 未写 | written 已写未交 | submitted 已交
  note: text('note'),
  createdAt: text('createdAt'),
})
export type Assignment = typeof assignments.$inferSelect
export type NewAssignment = typeof assignments.$inferInsert

export const notes = sqliteTable('notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  content: text('content'),
  tags: text('tags'),
  courseId: integer('courseId'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
})
export type Note = typeof notes.$inferSelect
export type NewNote = typeof notes.$inferInsert

// ---------- 知识库 KNOWLEDGE ----------

export const pitfalls = sqliteTable('pitfalls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  category: text('category').notNull().default('其他'),
  problem: text('problem'), // 问题描述
  solution: text('solution'), // 解决方案
  tags: text('tags'),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
})
export type Pitfall = typeof pitfalls.$inferSelect
export type NewPitfall = typeof pitfalls.$inferInsert

/** 学习资源 / 收藏链接（知识库模块） */
export const resources = sqliteTable('resources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  url: text('url').notNull(),
  category: text('category').notNull().default('favorite'), // dev | study | life | tool | favorite | other
  note: text('note'),
  createdAt: text('createdAt'),
})
export type Resource = typeof resources.$inferSelect
export type NewResource = typeof resources.$inferInsert

// ---------- 运维台账 OPS REGISTRY ----------

/** 流量预警台账（F-OPS-13） */
export const opsFlows = sqliteTable('opsFlows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  metric: text('metric').notNull().default('qps'), // qps | cpu | mem | bandwidth | disk
  threshold: real('threshold').notNull().default(0),
  current: real('current').notNull().default(0),
  status: text('status').notNull().default('ok'), // ok | warn | critical
  note: text('note'),
  updatedAt: text('updatedAt'),
  createdAt: text('createdAt'),
})
export type OpsFlow = typeof opsFlows.$inferSelect
export type NewOpsFlow = typeof opsFlows.$inferInsert

/** 配置变更台账（F-OPS-14） */
export const opsChanges = sqliteTable('opsChanges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  env: text('env').notNull().default('prod'), // prod | staging | dev
  category: text('category').notNull().default('config'), // config | deploy | rollback | other
  detail: text('detail'),
  operator: text('operator'),
  changedAt: text('changedAt'),
  status: text('status').notNull().default('done'), // planned | doing | done | rollback
  createdAt: text('createdAt'),
})
export type OpsChange = typeof opsChanges.$inferSelect
export type NewOpsChange = typeof opsChanges.$inferInsert

/** 安全巡检台账（F-OPS-15） */
export const opsSecChecks = sqliteTable('opsSecChecks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  category: text('category').notNull().default('other'), // port | patch | account | cert | log | other
  severity: text('severity').notNull().default('low'), // low | medium | high | critical
  result: text('result').notNull().default('pass'), // pass | fail | warn
  detail: text('detail'),
  checkedAt: text('checkedAt'),
  createdAt: text('createdAt'),
})
export type OpsSecCheck = typeof opsSecChecks.$inferSelect
export type NewOpsSecCheck = typeof opsSecChecks.$inferInsert

/** 密钥管理台账（F-OPS-16） */
export const opsSecrets = sqliteTable('opsSecrets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  provider: text('provider'),
  account: text('account'),
  status: text('status').notNull().default('active'), // active | expired | rotated
  expiresAt: text('expiresAt'),
  note: text('note'),
  createdAt: text('createdAt'),
})
export type OpsSecret = typeof opsSecrets.$inferSelect
export type NewOpsSecret = typeof opsSecrets.$inferInsert

/** DNS 记录台账（F-OPS-17） */
export const opsDns = sqliteTable('opsDns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  recordType: text('recordType').notNull().default('A'), // A | AAAA | CNAME | MX | TXT | NS | SRV
  host: text('host').notNull().default('@'),
  value: text('value').notNull(),
  ttl: integer('ttl').notNull().default(600),
  status: text('status').notNull().default('active'), // active | pending | disabled
  note: text('note'),
  createdAt: text('createdAt'),
})
export type OpsDnsRecord = typeof opsDns.$inferSelect
export type NewOpsDnsRecord = typeof opsDns.$inferInsert

// ---------- 开发台账扩展（F-DEV-09/11/12/13） ----------

/** 部署记录台账（F-DEV-09） */
export const deployments = sqliteTable('deployments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  project: text('project').notNull(),
  env: text('env').notNull().default('prod'), // prod | staging | dev
  version: text('version'),
  status: text('status').notNull().default('success'), // success | failed | rollback | pending
  deployedAt: text('deployedAt'),
  operator: text('operator'),
  note: text('note'),
  createdAt: text('createdAt'),
})
export type Deployment = typeof deployments.$inferSelect
export type NewDeployment = typeof deployments.$inferInsert

/** 环境变量清单（F-DEV-11） */
export const envVars = sqliteTable('envVars', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  value: text('value'),
  scope: text('scope').notNull().default('user'), // user | system | project
  note: text('note'),
  updatedAt: text('updatedAt'),
  createdAt: text('createdAt'),
})
export type EnvVar = typeof envVars.$inferSelect
export type NewEnvVar = typeof envVars.$inferInsert

/** 技术债/已知坑（F-DEV-12） */
export const techDebts = sqliteTable('techDebts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  category: text('category').notNull().default('tech'), // tech | knownIssue | legacy | TODO
  severity: text('severity').notNull().default('medium'), // low | medium | high | critical
  project: text('project'),
  status: text('status').notNull().default('open'), // open | planned | done
  detail: text('detail'),
  createdAt: text('createdAt'),
})
export type TechDebt = typeof techDebts.$inferSelect
export type NewTechDebt = typeof techDebts.$inferInsert

/** 命令片段速查（F-DEV-13） */
export const cmdSnippets = sqliteTable('cmdSnippets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  category: text('category').notNull().default('shell'), // shell | git | docker | db | deploy | other
  command: text('command').notNull(),
  note: text('note'),
  hitCount: integer('hitCount').notNull().default(0),
  createdAt: text('createdAt'),
})
export type CmdSnippet = typeof cmdSnippets.$inferSelect
export type NewCmdSnippet = typeof cmdSnippets.$inferInsert

// ---------- 知识库扩展（F-KNW-02/05/06/08/09/10） ----------

/** 决策日志（轻 ADR，F-KNW-02） */
export const decisions = sqliteTable('decisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  context: text('context'),
  decision: text('decision'),
  alternatives: text('alternatives'),
  status: text('status').notNull().default('proposed'), // proposed | accepted | rejected | superseded
  decidedAt: text('decidedAt'),
  createdAt: text('createdAt'),
})
export type Decision = typeof decisions.$inferSelect
export type NewDecision = typeof decisions.$inferInsert

/** 技能树节点（F-KNW-05） */
export const skillTree = sqliteTable('skillTree', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  parentId: integer('parentId'),
  level: integer('level').notNull().default(1),
  status: text('status').notNull().default('todo'), // todo | learning | mastered
  note: text('note'),
  createdAt: text('createdAt'),
})
export type SkillNode = typeof skillTree.$inferSelect
export type NewSkillNode = typeof skillTree.$inferInsert

/** 学习路径（F-KNW-06） */
export const learningPaths = sqliteTable('learningPaths', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  goal: text('goal'),
  step: text('step').notNull().default('1'),
  resource: text('resource'),
  status: text('status').notNull().default('todo'), // todo | doing | done
  orderIndex: integer('orderIndex').notNull().default(0),
  createdAt: text('createdAt'),
})
export type LearningPath = typeof learningPaths.$inferSelect
export type NewLearningPath = typeof learningPaths.$inferInsert

/** 3D 项目台账（F-KNW-08） */
export const threeDProjects = sqliteTable('threeDProjects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  tool: text('tool'), // blender | c4d | maya | unreal | unity | other
  category: text('category').notNull().default('model'), // model | scene | animation | render
  status: text('status').notNull().default('planning'), // planning | wip | done | archived
  path: text('path'),
  note: text('note'),
  createdAt: text('createdAt'),
})
export type ThreeDProject = typeof threeDProjects.$inferSelect
export type NewThreeDProject = typeof threeDProjects.$inferInsert

/** 作品集（F-KNW-09） */
export const portfolios = sqliteTable('portfolios', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  category: text('category').notNull().default('code'), // code | design | writing | video | other
  url: text('url'),
  path: text('path'),
  status: text('status').notNull().default('draft'), // draft | published | archived
  note: text('note'),
  createdAt: text('createdAt'),
})
export type Portfolio = typeof portfolios.$inferSelect
export type NewPortfolio = typeof portfolios.$inferInsert

/** 内容日历（F-KNW-10） */
export const contentCalendars = sqliteTable('contentCalendars', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  platform: text('platform').notNull().default('other'),
  plannedAt: text('plannedAt').notNull(),
  status: text('status').notNull().default('planned'), // planned | published | missed | cancelled
  note: text('note'),
  createdAt: text('createdAt'),
})
export type ContentCalendar = typeof contentCalendars.$inferSelect
export type NewContentCalendar = typeof contentCalendars.$inferInsert

// ---------- 生活扩展（F-LIFE-04 固定账单） ----------

/** 固定支出账单（F-LIFE-04）：房租/订阅/会员等周期固定支出，每月到期提醒 */
export const fixedBills = sqliteTable('fixedBills', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  amount: real('amount').notNull().default(0),
  category: text('category').notNull().default('订阅'), // 房租 | 订阅 | 会员 | 保险 | 话费 | 其他
  cycle: text('cycle').notNull().default('monthly'), // monthly | quarterly | yearly | weekly
  dueDay: integer('dueDay').notNull().default(1), // 每期扣款日（1~31）
  payMethod: text('payMethod'),
  status: text('status').notNull().default('active'), // active | paused
  note: text('note'),
  createdAt: text('createdAt'),
})
export type FixedBill = typeof fixedBills.$inferSelect
export type NewFixedBill = typeof fixedBills.$inferInsert

// ---------- 学习扩展（F-STU-04 成绩 / F-STU-09 闪卡） ----------

/** 成绩单（F-STU-04）：课程维度成绩记录 */
export const grades = sqliteTable('grades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  courseId: integer('courseId'),
  courseName: text('courseName').notNull(),
  examType: text('examType').notNull().default('期中'), // 期中 | 期末 | 平时 | 实验 | 其他
  score: real('score').notNull().default(0),
  total: real('total').notNull().default(100),
  weight: real('weight').notNull().default(1), // 占比权重
  date: text('date'),
  note: text('note'),
  createdAt: text('createdAt'),
})
export type Grade = typeof grades.$inferSelect
export type NewGrade = typeof grades.$inferInsert

/** 闪卡（F-STU-09）：正面问题/反面答案，支持间隔重复状态 */
export const flashcards = sqliteTable('flashcards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  front: text('front').notNull(),
  back: text('back').notNull(),
  deck: text('deck').notNull().default('默认'), // 卡组
  level: integer('level').notNull().default(0), // 0=新卡, 1=学习中, 2=熟悉, 3=已掌握
  dueDate: text('dueDate'), // 到期复习日期
  lastReview: text('lastReview'),
  reviewCount: integer('reviewCount').notNull().default(0),
  createdAt: text('createdAt'),
})
export type Flashcard = typeof flashcards.$inferSelect
export type NewFlashcard = typeof flashcards.$inferInsert

/** F-STU-08: reading queue */
export const readQueue = sqliteTable('readQueue', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  author: text('author'),
  category: text('category'),
  url: text('url'),
  status: text('status').notNull().default('queue'),
  priority: integer('priority').notNull().default(1),
  totalPages: integer('totalPages').notNull().default(0),
  currentPage: integer('currentPage').notNull().default(0),
  rating: integer('rating'),
  note: text('note'),
  addedAt: text('addedAt'),
  finishedAt: text('finishedAt'),
})
export type ReadQueueItem = typeof readQueue.$inferSelect
export type NewReadQueueItem = typeof readQueue.$inferInsert

/** F-STU-12: feynman logs */
export const feynmanLogs = sqliteTable('feynmanLogs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  topic: text('topic').notNull(),
  explanation: text('explanation').notNull(),
  gap: text('gap'),
  source: text('source'),
  status: text('status').notNull().default('draft'),
  createdAt: text('createdAt'),
})
export type FeynmanLog = typeof feynmanLogs.$inferSelect
export type NewFeynmanLog = typeof feynmanLogs.$inferInsert

/** 灵感：快速捕捉的碎片想法（#标签 由前端解析后存入 tags） */
export const inspirations = sqliteTable('inspirations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  content: text('content').notNull(),
  tags: text('tags'), // 逗号分隔
  mood: text('mood'), // good | neutral | bad（可空）
  starred: integer('starred').notNull().default(0),
  createdAt: text('createdAt'),
  updatedAt: text('updatedAt'),
})
export type Inspiration = typeof inspirations.$inferSelect
export type NewInspiration = typeof inspirations.$inferInsert

/**
 * 个人档案（跨端头像同步，单行语义）。
 * 固定整型主键（约定单行 id=1 语义）而非文本 'me'：推拉引擎全链路按整数主键设计
 * （_sync_state.rowId INTEGER、applyRemoteBatch 拼接 `WHERE id = ${rowId}`、
 * relay push 的 Number(id)>0 判定与 AUTOINCREMENT 分配），文本主键会破坏这三处。
 * 列名与 src/db/migrate.ts 及 relay/db/schema.sql 保持一致。
 */
export const profile = sqliteTable('profile', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  avatarText: text('avatarText'),
  avatarColor: text('avatarColor'),
  avatarImg: text('avatarImg'), // 头像 dataURL（JPEG，约几十 KB）
  updatedAt: integer('updatedAt'), // ms 时间戳
})
export type Profile = typeof profile.$inferSelect
export type NewProfile = typeof profile.$inferInsert
