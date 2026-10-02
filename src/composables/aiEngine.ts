// 智能层本地执行引擎（F-AI-01~10 实际后端实现）
// 说明：以本地台账数据 + 轻量算法实现语义搜索/自动分类/去重/建议/洞察/摘要/生成/问答/规则引擎/自动标签，
// 供 HomeView 智能层执行面板调用；各能力与 HomeView 中 wb:ai-switches 开关联动（调用前由视图判断开关）。
import { tasksRepo, notesRepo, pitfallsRepo, snippetsRepo, projectsRepo, habitsRepo, habitLogsRepo, ledgerRepo, deadlinesRepo, agentsRepo } from '@/db'
import { llmConfigured, llmChat } from './llmClient'

export interface AiEngineResult {
  ok: boolean
  kind: string
  items: Array<{ title: string; meta: string; score: number }>
  summary?: string
}

// 关键词切分：中英文混合按空白与常用分隔符拆分
function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .split(/[\s,，。；;、:：/\\|()（）\[\]{}]+/)
    .filter((t) => t.length > 0)
}

function scoreText(queryTokens: string[], text: string): number {
  if (!text) return 0
  const t = text.toLowerCase()
  let score = 0
  for (const tok of queryTokens) {
    if (t.includes(tok)) score += tok.length > 1 ? 2 : 1
  }
  return score
}

// F-AI-01 语义搜索：跨 tasks/notes/pitfalls/snippets/projects 检索
export async function aiSemanticSearch(query: string, limit = 8): Promise<AiEngineResult> {
  // 搜索语法：#标签 过滤标签关键词；type:任务|笔记|踩坑|片段|项目 限定类型
  const tagRe = /#([\w\u4e00-\u9fa5-]+)/g
  const tags: string[] = []
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(query)) !== null) tags.push(m[1])
  const typeRe = /type:([\w\u4e00-\u9fa5]+)/g
  const types: string[] = []
  while ((m = typeRe.exec(query)) !== null) types.push(m[1])
  const clean = query.replace(tagRe, ' ').replace(typeRe, ' ')
  const toks = tokenize(clean)
  const rows: { title: string; meta: string; score: number }[] = []
  if (!toks.length && !tags.length && !types.length) return { ok: false, kind: 'semantic_search', items: [], summary: '请输入关键词' }
  const push = (title: string, meta: string, text: string) => {
    if (types.length && !types.some((t) => meta.includes(t))) return
    if (tags.length && !tags.every((t) => (meta + ' ' + text).toLowerCase().includes(t.toLowerCase()))) return
    const s = toks.length ? scoreText(toks, `${title} ${text}`) : 1
    if (s > 0) rows.push({ title, meta, score: s })
  }
  const [tasks, notes, pitfalls, snippets, projects] = await Promise.all([
    tasksRepo.listAll(), notesRepo.listAll(), pitfallsRepo.listAll(), snippetsRepo.listAll(), projectsRepo.listAll(),
  ])
  tasks.forEach((t) => push(t.title, `任务 · ${t.scope || ''} ${t.status || ''}`, t.note || ''))
  notes.forEach((n) => push(n.title, `笔记 · ${n.tags || '未分类'}`, n.content || ''))
  pitfalls.forEach((p) => push(p.title, `踩坑 · ${p.category || ''}`, `${p.problem || ''} ${p.solution || ''}`))
  snippets.forEach((s) => push(s.title, `片段 · ${s.language || ''}`, `${s.code || ''} ${s.description || ''}`))
  projects.forEach((p) => push(p.name, `项目 · ${p.status || ''}`, p.description || ''))
  rows.sort((a, b) => b.score - a.score)
  return {
    ok: true,
    kind: 'semantic_search',
    items: rows.slice(0, limit),
    summary: `语义检索命中 ${rows.length} 条，已展示前 ${Math.min(rows.length, limit)} 条`,
  }
}

// F-AI-02 自动分类：为输入文本建议归属模块
const CATEGORY_RULES: Array<{ label: string; keywords: string[] }> = [
  { label: '开发/技术', keywords: ['代码', 'git', '部署', '接口', 'bug', '重构', '依赖', '编译', '报错', '函数'] },
  { label: '运维/系统', keywords: ['服务器', '域名', '端口', '备份', '安全', '证书', '密钥', '监控', '日志', '升级'] },
  { label: '工作流/Agent', keywords: ['agent', '工作流', '任务', '自动化', 'prompt', '智能体', '调度'] },
  { label: '生活/健康', keywords: ['运动', '睡眠', '饮食', '习惯', '记账', '账单', '番茄', '作息'] },
  { label: '学习/知识', keywords: ['课程', '笔记', '作业', '考试', '闪卡', '阅读', '论文', '复习', '错题'] },
  { label: '创作/项目', keywords: ['设计', '作品', '文档', '方案', '策划', '模型', '渲染', '剪辑'] },
]
export function aiAutoClassify(text: string): AiEngineResult {
  const t = (text || '').toLowerCase()
  if (!t) return { ok: false, kind: 'auto_classify', items: [], summary: '请输入内容' }
  const scored = CATEGORY_RULES.map((r) => {
    const hits = r.keywords.filter((k) => t.includes(k))
    return { label: r.label, score: hits.length, meta: hits.join('、') }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  if (!scored.length) return { ok: false, kind: 'auto_classify', items: [], summary: '未识别到明确类别关键词' }
  return { ok: true, kind: 'auto_classify', items: scored.map((s) => ({ title: s.label, meta: s.meta || '命中关键词', score: s.score })), summary: `建议归类：${scored[0].label}` }
}

// F-AI-03 去重检测：按标题相似度识别重复任务/笔记/片段
function normTitle(s: string): string {
  return (s || '').toLowerCase().replace(/[，。；、\s:：,.;-]+/g, '').slice(0, 40)
}
export async function aiDedupe(): Promise<AiEngineResult> {
  const [tasks, notes, snippets] = await Promise.all([tasksRepo.listAll(), notesRepo.listAll(), snippetsRepo.listAll()])
  const buckets = new Map<string, { kind: string; title: string }[]>()
  const put = (kind: string, title: string) => {
    const key = normTitle(title)
    if (!key) return
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push({ kind, title })
  }
  tasks.forEach((t) => put('任务', t.title))
  notes.forEach((n) => put('笔记', n.title))
  snippets.forEach((s) => put('片段', s.title))
  const dupes = [...buckets.values()].filter((v) => v.length > 1).slice(0, 10)
  return {
    ok: true,
    kind: 'dedupe',
    items: dupes.map((g) => ({ title: g[0].title, meta: `重复 ×${g.length}（${g.map((x) => x.kind).join('/')}）`, score: g.length })),
    summary: dupes.length ? `发现 ${dupes.length} 组疑似重复` : '未发现明显重复条目',
  }
}

// F-AI-04 智能建议：基于习惯连续打卡、任务积压、备份状态给建议
export async function aiSuggest(): Promise<AiEngineResult> {
  const [habits, habitLogs, tasks, deadlines, ledger, agents] = await Promise.all([
    habitsRepo.listAll(), habitLogsRepo.listAll(), tasksRepo.listAll(), deadlinesRepo.listAll(), ledgerRepo.listAll(), agentsRepo.listAll(),
  ])
  const items: { title: string; meta: string; score: number }[] = []
  // 习惯连续打卡分析（最近 7 天连续率）
  const today = new Date()
  const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const last7 = new Set<string>()
  for (let i = 0; i < 7; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    last7.add(dayKey(d))
  }
  for (const h of habits) {
    const dates = new Set(habitLogs.filter((l) => l.habitId === h.id).map((l) => l.date))
    const streak = [...last7].filter((d) => dates.has(d)).length
    if (streak < 3) items.push({ title: `习惯「${h.name}」近 7 天仅打卡 ${streak} 次`, meta: '建议设定每日固定提醒时间', score: 7 - streak })
  }
  const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'completed')
  if (openTasks.length >= 8) items.push({ title: `未完成任务已达 ${openTasks.length} 个`, meta: '建议按优先级清理积压，或将大任务拆分为子任务', score: 4 })
  const expiring = deadlines.filter((d) => d.status !== 'done' && d.dueDate && d.dueDate <= todayStrPlus(today, 3))
  if (expiring.length) items.push({ title: `${expiring.length} 个截止事项将在 3 天内到期`, meta: expiring.map((e) => e.title).slice(0, 3).join('、'), score: 3 })
  const stalledAgents = agents.filter((a) => a.status === 'stalled')
  if (stalledAgents.length) items.push({ title: `${stalledAgents.length} 个 Agent 处于卡死状态`, meta: '建议触发自愈预案：先重试，再回滚到上一个检查点', score: 5 })
  const income = ledger.filter((l) => l.type === 'income').reduce((s, l) => s + (l.amount || 0), 0)
  const expense = ledger.filter((l) => l.type === 'expense').reduce((s, l) => s + (l.amount || 0), 0)
  if (expense > income && income > 0) items.push({ title: '本月支出已超过收入', meta: `收入 ${income} / 支出 ${expense}，建议复盘固定账单`, score: 3 })
  items.sort((a, b) => b.score - a.score)
  return { ok: true, kind: 'suggest', items: items.slice(0, 6), summary: `生成 ${items.length} 条建议` }
}
function todayStrPlus(d: Date, plus: number): string {
  const x = new Date(d)
  x.setDate(x.getDate() + plus)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

// F-AI-05 数据洞察：汇总统计输出关键洞察（供 HomeView insights 复用）
export async function aiInsights(): Promise<AiEngineResult> {
  const [tasks, notes, pitfalls, habits, habitLogs, ledger, projects] = await Promise.all([
    tasksRepo.listAll(), notesRepo.listAll(), pitfallsRepo.listAll(), habitsRepo.listAll(), habitLogsRepo.listAll(), ledgerRepo.listAll(), projectsRepo.listAll(),
  ])
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'completed').length
  const income = ledger.filter((l) => l.type === 'income').reduce((s, l) => s + (l.amount || 0), 0)
  const expense = ledger.filter((l) => l.type === 'expense').reduce((s, l) => s + (l.amount || 0), 0)
  const items: { title: string; meta: string; score: number }[] = [
    { title: `任务完成率 ${tasks.length ? Math.round((done / tasks.length) * 100) : 0}%`, meta: `${done}/${tasks.length} 已完成`, score: 5 },
    { title: `笔记沉淀 ${notes.length} 篇 · 踩坑 ${pitfalls.length} 条`, meta: '知识库体量', score: 4 },
    { title: `项目 ${projects.length} 个 · 习惯 ${habits.length} 个 · 打卡 ${habitLogs.length} 次`, meta: '台账概览', score: 3 },
    { title: `收支结余 ${(income - expense).toFixed(2)}`, meta: `收入 ${income.toFixed(2)} / 支出 ${expense.toFixed(2)}`, score: 4 },
  ]
  return { ok: true, kind: 'insight', items, summary: '基于台账数据生成的 4 条核心洞察' }
}

// F-AI-06 内容摘要：抽取长文本要点（首句 + 高频词句）
export function aiSummarize(text: string, maxPoints = 5): AiEngineResult {
  const src = (text || '').trim()
  if (!src) return { ok: false, kind: 'summarize', items: [], summary: '请输入待摘要内容' }
  const sentences = src.split(/[。！？!?\n]+/).map((s) => s.trim()).filter(Boolean)
  const lead = sentences.slice(0, 2).join('。')
  const words = tokenize(src).filter((w) => w.length > 1)
  const freq = new Map<string, number>()
  words.forEach((w) => freq.set(w, (freq.get(w) || 0) + 1))
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxPoints).map(([w]) => w)
  return {
    ok: true,
    kind: 'summarize',
    items: [
      { title: '开篇要点', meta: lead.slice(0, 120) || src.slice(0, 120), score: 5 },
      { title: '高频关键词', meta: top.join('、') || '—', score: 4 },
      { title: '篇幅', meta: `${src.length} 字 · ${sentences.length} 句`, score: 3 },
    ],
    summary: `摘要完成：共 ${src.length} 字，提炼 ${maxPoints} 个关键词`,
  }
}

// F-AI-07 内容生成：基于模板生成周报 / 交接包 / 任务草稿
export async function aiGenerate(kind: string, goal = ''): Promise<AiEngineResult> {
  const [tasks, notes, pitfalls] = await Promise.all([tasksRepo.listAll(), notesRepo.listAll(), pitfallsRepo.listAll()])
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'completed')
  if (kind === 'report') {
    const lines = [
      `# 工作周报（自动生成）`,
      ``,
      `## 本周完成（${done.length} 项）`,
      ...done.slice(0, 8).map((t) => `- [x] ${t.title}`),
      ``,
      `## 知识沉淀`,
      `- 新增笔记 ${notes.length} 篇，踩坑记录 ${pitfalls.length} 条`,
      ``,
      `## 下周计划`,
      `- ${goal || '待补充'}（可在智能层执行面板输入目标后重新生成）`,
    ]
    return { ok: true, kind: 'generate', items: [{ title: '周报草稿', meta: lines.join('\n'), score: 5 }], summary: '已生成 Markdown 周报草稿' }
  }
  if (kind === 'handoff') {
    const lines = [
      `# 交接包`,
      ``,
      `**目标**：${goal || '（未填写目标）'}`,
      ``,
      `**未完成任务**：${tasks.filter((t) => t.status !== 'done').length} 项`,
      ...tasks.filter((t) => t.status !== 'done').slice(0, 6).map((t) => `- [ ] ${t.title}`),
      ``,
      `**经验沉淀**：${pitfalls.length} 条踩坑记录`,
    ]
    return { ok: true, kind: 'generate', items: [{ title: '交接包', meta: lines.join('\n'), score: 5 }], summary: '已生成交接包草稿' }
  }
  const lines = [`# 任务草稿`, ``, `**目标**：${goal || '未填写'}`, ``, `- [ ] 调研现状与约束`, `- [ ] 制定执行方案`, `- [ ] 实施并自测`, `- [ ] 记录踩坑`, `- [ ] 验收并归档`]
  return { ok: true, kind: 'generate', items: [{ title: '任务拆解草稿', meta: lines.join('\n'), score: 5 }], summary: '已生成标准任务拆解草稿' }
}

// F-AI-08 智能问答：优先使用已配置 LLM 服务回答；未配置或调用失败时降级本地检索
export async function aiQa(question: string): Promise<AiEngineResult> {
  const toks = tokenize(question)
  if (!toks.length) return { ok: false, kind: 'qa', items: [], summary: '请输入问题' }
  const [notes, pitfalls, snippets] = await Promise.all([notesRepo.listAll(), pitfallsRepo.listAll(), snippetsRepo.listAll()])
  const rows: { title: string; meta: string; score: number }[] = []
  const push = (title: string, text: string, kind: string) => {
    const s = scoreText(toks, text)
    if (s > 0) rows.push({ title, meta: text.slice(0, 160), score: s + (kind === '踩坑' ? 1 : 0) })
  }
  notes.forEach((n) => push(`笔记：${n.title}`, `${n.content || ''} ${n.tags || ''}`, '笔记'))
  pitfalls.forEach((p) => push(`踩坑：${p.title}`, `${p.problem || ''} ${p.solution || ''}`, '踩坑'))
  snippets.forEach((s) => push(`片段：${s.title}`, `${s.code || ''} ${s.description || ''}`, '片段'))
  rows.sort((a, b) => b.score - a.score)

  // 已配置 LLM：以本地检索结果为上下文，优先由 LLM 生成回答
  if (llmConfigured()) {
    try {
      const ctx = rows.slice(0, 4).map((r) => `- ${r.title}\n  ${r.meta}`).join('\n')
      const answer = await llmChat(
        '你是 WORKBENCH 个人工作台智能助手。请基于给定的本地台账上下文，用简洁中文回答用户问题；上下文不足时如实说明，不要编造事实。',
        `问题：${question}\n\n本地台账上下文：\n${ctx || '（本地台账无匹配记录）'}`,
      )
      if (answer.trim()) {
        return {
          ok: true,
          kind: 'qa',
          items: [{ title: 'AI 回答', meta: answer.trim().slice(0, 2000), score: 5 }],
          summary: rows.length ? `已结合 ${rows.length} 条本地记录，由 LLM 服务生成回答` : '由 LLM 服务直接回答（本地台账无匹配记录）',
        }
      }
    } catch {
      // LLM 调用失败，降级本地检索
    }
  }

  if (!rows.length) return { ok: false, kind: 'qa', items: [], summary: '本地台账中未找到相关答案，建议补充笔记或配置 LLM 服务' }
  return { ok: true, kind: 'qa', items: rows.slice(0, 4), summary: `找到 ${rows.length} 条相关记录，最相关：${rows[0].title}` }
}

// F-AI-10 自动标签：按关键词为文本推荐标签
const TAG_RULES: Array<{ tag: string; keywords: string[] }> = [
  { tag: '前端', keywords: ['vue', 'react', 'css', '组件', '页面', 'tsx'] },
  { tag: '后端', keywords: ['api', '接口', '服务', '数据库', 'redis', 'mq'] },
  { tag: '运维', keywords: ['部署', '服务器', 'docker', 'k8s', 'ci', 'cd'] },
  { tag: '学习', keywords: ['课程', '考试', '作业', '复习', '笔记'] },
  { tag: '生活', keywords: ['健康', '记账', '习惯', '运动', '睡眠'] },
  { tag: 'AI', keywords: ['agent', 'llm', '模型', 'prompt', '智能'] },
]
export function aiAutoTag(text: string): AiEngineResult {
  const t = (text || '').toLowerCase()
  if (!t) return { ok: false, kind: 'auto_tag', items: [], summary: '请输入内容' }
  const hit = TAG_RULES.filter((r) => r.keywords.some((k) => t.includes(k))).map((r) => r.tag)
  const defaultTags = ['待整理']
  const tags = [...new Set(hit.length ? hit : defaultTags)]
  return { ok: true, kind: 'auto_tag', items: tags.map((tag) => ({ title: tag, meta: hit.length ? '命中规则关键词' : '无命中，使用默认标签', score: 1 })), summary: `推荐标签：${tags.join('、')}` }
}
