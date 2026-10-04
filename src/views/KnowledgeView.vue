<script setup lang="ts">
import { watch, ref, onMounted, computed } from 'vue'
import { refreshTick } from '@/stores/ui'
import { NButton, NTag, NTabs, NTabPane, NIcon, useMessage, NInput } from 'naive-ui'
import { Plus, Trash, ExternalLink, AlertTriangle, Refresh } from '@vicons/tabler'
import EmptyState from '@/components/EmptyState.vue'
import ModalForm, { type FieldDef } from '@/components/ModalForm.vue'
import { pitfallsRepo, resourcesRepo, decisionsRepo, skillTreeRepo, learningPathsRepo, threeDProjectsRepo, portfoliosRepo, contentCalendarsRepo, linksRepo } from '@/db'
import type { Pitfall, Resource, Decision, SkillNode, LearningPath, ThreeDProject, Portfolio, ContentCalendar, Link } from '../../drizzle/schema'
import { scanAssets, type AssetInfo } from '@/composables/useTauri'
import { useConfirm } from '@/composables/useConfirm'

const message = useMessage()
const { confirm } = useConfirm()
const pitfalls = ref<Pitfall[]>([])
const links = ref<Resource[]>([])
const pitfallFormShow = ref(false)
const linkFormShow = ref(false)
const keyword = ref('')
const decisions = ref<Decision[]>([])
const skillNodes = ref<SkillNode[]>([])
const paths = ref<LearningPath[]>([])
const threeD = ref<ThreeDProject[]>([])
const portfolios = ref<Portfolio[]>([])
const contentCal = ref<ContentCalendar[]>([])
const allLinks = ref<Link[]>([])
const decisionFormShow = ref(false)
const skillFormShow = ref(false)
const pathFormShow = ref(false)
const threeDFormShow = ref(false)
const portfolioFormShow = ref(false)
const contentFormShow = ref(false)
const batchFormShow = ref(false)
const batchText = ref('')
const batchKind = ref<'pitfall' | 'resource'>('pitfall')

// ---- 复习计划（F-KNW-06）：按间隔 1/3/7/14/30 天递增提醒回顾踩坑与资源 ----
const REVIEW_INTERVALS = [1, 3, 7, 14, 30]
type ReviewRec = { kind: 'pitfall' | 'resource'; id: number; at: string }
const reviewRecs = ref<ReviewRec[]>([])
function loadReviewRecs() {
  try {
    const raw = localStorage.getItem('wb:review-records')
    if (raw) reviewRecs.value = JSON.parse(raw)
  } catch { reviewRecs.value = [] }
}
function persistReviewRecs() {
  try { localStorage.setItem('wb:review-records', JSON.stringify(reviewRecs.value)) } catch { /* ignore */ }
}
const reviewDueAt = (kind: 'pitfall' | 'resource', id: number, createdAt?: string | null) => {
  const done = reviewRecs.value.filter((r) => r.kind === kind && r.id === id).length
  if (done >= REVIEW_INTERVALS.length) return null
  const base = createdAt ? new Date(createdAt.replace(' ', 'T')).getTime() : Date.now()
  return base + REVIEW_INTERVALS[done] * 86400000
}
const reviewProgress = (kind: 'pitfall' | 'resource', id: number) => {
  const done = reviewRecs.value.filter((r) => r.kind === kind && r.id === id).length
  return Math.min(done, REVIEW_INTERVALS.length)
}
function markReviewed(kind: 'pitfall' | 'resource', id: number) {
  reviewRecs.value.push({ kind, id, at: new Date().toISOString() })
  persistReviewRecs()
  message.success('已标记复习，下次复习间隔将递增')
}
const reviewItems = computed(() => {
  const items: { kind: 'pitfall' | 'resource'; id: number; title: string; category: string; due: number; progress: number }[] = []
  pitfalls.value.forEach((p) => {
    const due = reviewDueAt('pitfall', p.id, p.createdAt)
    if (due !== null && due <= Date.now()) {
      items.push({ kind: 'pitfall', id: p.id, title: p.title, category: p.category || '其他', due, progress: reviewProgress('pitfall', p.id) })
    }
  })
  links.value.forEach((l) => {
    const due = reviewDueAt('resource', l.id, l.createdAt)
    if (due !== null && due <= Date.now()) {
      items.push({ kind: 'resource', id: l.id, title: l.title, category: l.category || 'favorite', due, progress: reviewProgress('resource', l.id) })
    }
  })
  return items.sort((a, b) => a.due - b.due)
})
loadReviewRecs()

// ---- 能力层：素材索引（F-KNW-07） ----
const assetRoot = ref('E:\\')
const assets = ref<AssetInfo[]>([])
const assetLoading = ref(false)

async function runAssets() {
  assetLoading.value = true
  try {
    assets.value = await scanAssets(assetRoot.value)
  } catch {
    assets.value = []
    message.warning('素材扫描仅 Tauri 环境可用')
  } finally {
    assetLoading.value = false
  }
}

const CATEGORY_LABEL: Record<string, string> = {
  image: '图片', video: '视频', audio: '音频', model: '模型', doc: '文档', other: '其他',
}
const categoryColor = (c: string) =>
  (({ image: 'success', video: 'info', audio: 'warning', model: 'error', doc: 'default', other: 'default' } as Record<string, 'success' | 'info' | 'warning' | 'error' | 'default'>)[c] ?? 'default')
const fmtSize = (b: number) => {
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB'
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB'
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB'
  return b + ' B'
}
const assetGroups = computed(() => {
  const groups: { category: string; items: AssetInfo[] }[] = []
  for (const c of ['image', 'video', 'audio', 'model', 'doc', 'other']) {
    const items = assets.value.filter((a) => a.category === c)
    if (items.length) groups.push({ category: c, items })
  }
  return groups
})

async function load() {
  try {
    const [ps, ls, ds, sk, pa, td, pf, cc, lk] = await Promise.all([
      pitfallsRepo.listAll(), resourcesRepo.listAll(), decisionsRepo.listAll(), skillTreeRepo.listAll(),
      learningPathsRepo.listAll(), threeDProjectsRepo.listAll(), portfoliosRepo.listAll(),
      contentCalendarsRepo.listAll(), linksRepo.listAll(),
    ])
    pitfalls.value = ps
    links.value = ls
    decisions.value = ds
    skillNodes.value = sk
    paths.value = pa
    threeD.value = td
    portfolios.value = pf
    contentCal.value = cc
    allLinks.value = lk
  } catch (e) {
    message.warning('数据加载失败（浏览器降级为演示模式）')
    console.warn(e)
  }
}
watch(refreshTick, () => load())
onMounted(load)

// ---- 踩坑库 ----
const pitfallFields: FieldDef[] = [
  { key: 'title', label: '标题', required: true, span: 2 },
  { key: 'category', label: '分类', options: [
    { label: '前端', value: '前端' }, { label: '后端', value: '后端' },
    { label: '数据库', value: '数据库' }, { label: '运维', value: '运维' },
    { label: '工具', value: '工具' }, { label: '其他', value: '其他' },
  ] },
  { key: 'tags', label: '标签 (逗号分隔)', span: 2 },
  { key: 'problem', label: '问题描述', type: 'textarea', span: 2 },
  { key: 'solution', label: '解决方案', type: 'textarea', span: 2 },
]

async function addPitfall(v: Record<string, unknown>) {
  try {
    await pitfallsRepo.insert({
      title: String(v.title), category: String(v.category || '其他'),
      tags: String(v.tags || ''), problem: String(v.problem || ''), solution: String(v.solution || ''),
    })
    message.success('已记入踩坑库')
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}

async function removePitfall(p: Pitfall) {
  const ok = await confirm({ title: '删除踩坑记录？', content: `「${p.title}」删除后无法恢复。` })
  if (!ok) return
  try {
    await pitfallsRepo.remove(p.id)
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
}

const filteredPitfalls = computed(() =>
  keyword.value
    ? pitfalls.value.filter(
        (p) => p.title.includes(keyword.value) || (p.tags || '').includes(keyword.value) || (p.problem || '').includes(keyword.value),
      )
    : pitfalls.value,
)

// ---- 学习资源 ----
const linkFields: FieldDef[] = [
  { key: 'title', label: '标题', required: true, span: 2 },
  { key: 'url', label: '链接', required: true, span: 2 },
  { key: 'category', label: '分类', options: [
    { label: '开发', value: 'dev' }, { label: '学习', value: 'study' }, { label: '生活', value: 'life' },
    { label: '工具', value: 'tool' }, { label: '收藏', value: 'favorite' }, { label: '其他', value: 'other' },
  ] },
  { key: 'note', label: '备注', span: 2 },
]

async function addLink(v: Record<string, unknown>) {
  try {
    await resourcesRepo.insert({
      title: String(v.title), url: String(v.url),
      category: String(v.category || 'favorite'), note: String(v.note || ''),
    })
    message.success('链接已收藏')
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}

async function removeLink(l: Resource) {
  const ok = await confirm({ title: '删除收藏链接？', content: `「${l.title}」${l.url}。` })
  if (!ok) return
  try {
    await resourcesRepo.remove(l.id)
    message.success('已删除')
    load()
  } catch { message.error('删除失败') }
}

const openLink = (l: Resource) => window.open(l.url, '_blank')
const linkColor = (c: string) =>
  ({ dev: 'success', study: 'info', life: 'warning', tool: 'default', favorite: 'error', other: 'default' })[c] ?? 'default'

// ---- F-KNW-02 决策日志（轻 ADR） ----
const decisionFields: FieldDef[] = [
  { key: 'title', label: '决策标题', required: true, span: 2 },
  { key: 'context', label: '背景', type: 'textarea', span: 2 },
  { key: 'decision', label: '决策内容', type: 'textarea', span: 2 },
  { key: 'alternatives', label: '备选方案', type: 'textarea', span: 2 },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '提案中', value: 'proposed' }, { label: '已采纳', value: 'accepted' },
    { label: '已否决', value: 'rejected' }, { label: '被取代', value: 'superseded' },
  ] },
  { key: 'decidedAt', label: '决策日期', type: 'date' },
]
async function addDecision(v: Record<string, unknown>) {
  try {
    await decisionsRepo.insert({
      title: String(v.title), context: String(v.context || ''), decision: String(v.decision || ''),
      alternatives: String(v.alternatives || ''), status: String(v.status || 'proposed'),
      decidedAt: v.decidedAt ? String(v.decidedAt) : undefined,
    })
    message.success('决策已记录')
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function removeDecision(d: Decision) {
  const ok = await confirm({ title: '删除决策记录？', content: `「${d.title}」${d.decidedAt || '无日期'}，删除后无法恢复。` })
  if (!ok) return
  try { await decisionsRepo.remove(d.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}
const decisionStatus = (d: Decision) => ({
  color: (d.status === 'accepted' ? 'success' : d.status === 'rejected' ? 'error' : d.status === 'superseded' ? 'warning' : 'info') as 'success' | 'error' | 'warning' | 'info',
  label: d.status === 'accepted' ? '已采纳' : d.status === 'rejected' ? '已否决' : d.status === 'superseded' ? '被取代' : '提案中',
})

// ---- F-KNW-05 技能树 ----
const skillFields: FieldDef[] = [
  { key: 'name', label: '技能名', required: true },
  { key: 'parentName', label: '父级技能名（留空为根节点）' },
  { key: 'level', label: '层级', type: 'select', options: [
    { label: 'L1 基础', value: '1' }, { label: 'L2 进阶', value: '2' }, { label: 'L3 熟练', value: '3' }, { label: 'L4 专家', value: '4' },
  ] },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '待学', value: 'todo' }, { label: '学习中', value: 'learning' }, { label: '已掌握', value: 'mastered' },
  ] },
  { key: 'note', label: '备注', span: 2 },
]
async function addSkill(v: Record<string, unknown>) {
  try {
    const parentName = String(v.parentName || '').trim()
    const parent = parentName ? skillNodes.value.find((s) => s.name === parentName) : undefined
    await skillTreeRepo.insert({
      name: String(v.name), parentId: parent ? parent.id : undefined,
      level: Number(v.level || 1), status: String(v.status || 'todo'), note: String(v.note || ''),
    })
    message.success('技能节点已添加')
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function removeSkill(s: SkillNode) {
  const ok = await confirm({ title: '删除技能节点？', content: `「${s.name}」L${s.level}，删除后无法恢复。` })
  if (!ok) return
  try { await skillTreeRepo.remove(s.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}
const skillStatusColor = (s: SkillNode) => (s.status === 'mastered' ? 'success' : s.status === 'learning' ? 'info' : 'default') as 'success' | 'info' | 'default'
const skillTreeComputed = computed(() => {
  // 原先 childrenOf 对每个节点全表扫描 skillNodes，递归后是 O(n²)；
  // 这里先建一次 parentId -> children 索引，整体降为 O(n)。
  const ids = new Set(skillNodes.value.map((s) => s.id))
  const byParent = new Map<number, SkillNode[]>()
  for (const s of skillNodes.value) {
    const pid = s.parentId ?? 0
    const arr = byParent.get(pid)
    if (arr) arr.push(s)
    else byParent.set(pid, [s])
  }
  const roots = skillNodes.value.filter((s) => !s.parentId || !ids.has(s.parentId))
  const render = (n: SkillNode, depth: number): string => {
    const kids = byParent.get(n.id) ?? []
    const childHtml = kids.length ? `<div class="st-children">${kids.map((k) => render(k, depth + 1)).join('')}</div>` : ''
    return `<div class="st-node" style="margin-left:${depth * 22}px"><span class="st-dot" data-st="${escHtml(n.status)}"></span>${escHtml(n.name)}<span class="st-meta">L${n.level} · ${escHtml(n.status)}</span>${childHtml}</div>`
  }
  return roots.map((r) => render(r, 0)).join('')
})

/** 转义 HTML，避免节点名称里的特殊字符破坏结构或被注入 */
function escHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
const skillTreeHtml = computed(() => `<div class="st-tree">${skillTreeComputed.value || '<p class="dim">暂无技能节点</p>'}</div>`)

// ---- F-KNW-06 学习路径 ----
const pathFields: FieldDef[] = [
  { key: 'title', label: '步骤标题', required: true },
  { key: 'goal', label: '目标说明', span: 2 },
  { key: 'step', label: '阶段序号' },
  { key: 'resource', label: '参考资源' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '待开始', value: 'todo' }, { label: '进行中', value: 'doing' }, { label: '已完成', value: 'done' },
  ] },
]
async function addPath(v: Record<string, unknown>) {
  try {
    const nextOrder = paths.value.length ? Math.max(...paths.value.map((p) => p.orderIndex || 0)) + 1 : 0
    await learningPathsRepo.insert({
      title: String(v.title), goal: String(v.goal || ''), step: String(v.step || String(nextOrder + 1)),
      resource: String(v.resource || ''), status: String(v.status || 'todo'), orderIndex: nextOrder,
    })
    message.success('学习路径已添加')
    load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function togglePathStatus(p: LearningPath) {
  const next = p.status === 'todo' ? 'doing' : p.status === 'doing' ? 'done' : 'todo'
  try { await learningPathsRepo.update(p.id, { status: next }); p.status = next; load() } catch { message.error('更新失败') }
}
async function removePath(p: LearningPath) {
  const ok = await confirm({ title: '删除学习路径步骤？', content: `「${p.title}」第 ${p.step} 步，删除后无法恢复。` })
  if (!ok) return
  try { await learningPathsRepo.remove(p.id); message.success('已删除'); load() } catch { message.error('删除失败') }
}

// ---- F-KNW-08/09/10 创作台账（3D / 作品集 / 内容日历） ----
const threeDFields: FieldDef[] = [
  { key: 'name', label: '项目名', required: true },
  { key: 'tool', label: '工具', type: 'select', options: [
    { label: 'Blender', value: 'blender' }, { label: 'C4D', value: 'c4d' }, { label: 'Maya', value: 'maya' },
    { label: 'Unreal', value: 'unreal' }, { label: 'Unity', value: 'unity' }, { label: '其他', value: 'other' },
  ] },
  { key: 'category', label: '类别', type: 'select', options: [
    { label: '模型', value: 'model' }, { label: '场景', value: 'scene' }, { label: '动画', value: 'animation' }, { label: '渲染', value: 'render' },
  ] },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '规划中', value: 'planning' }, { label: '制作中', value: 'wip' }, { label: '已完成', value: 'done' }, { label: '归档', value: 'archived' },
  ] },
  { key: 'path', label: '文件路径' },
  { key: 'note', label: '备注', span: 2 },
]
const portfolioFields: FieldDef[] = [
  { key: 'title', label: '作品名', required: true },
  { key: 'category', label: '类别', type: 'select', options: [
    { label: '代码', value: 'code' }, { label: '设计', value: 'design' }, { label: '写作', value: 'writing' },
    { label: '视频', value: 'video' }, { label: '其他', value: 'other' },
  ] },
  { key: 'url', label: '作品链接' },
  { key: 'path', label: '本地路径' },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '草稿', value: 'draft' }, { label: '已发布', value: 'published' }, { label: '已归档', value: 'archived' },
  ] },
  { key: 'note', label: '备注', span: 2 },
]
const contentFields: FieldDef[] = [
  { key: 'title', label: '内容标题', required: true },
  { key: 'platform', label: '平台', options: [
    { label: '公众号', value: 'wechat' }, { label: '掘金', value: 'juejin' }, { label: '知乎', value: 'zhihu' },
    { label: 'B站', value: 'bilibili' }, { label: '小红书', value: 'xiaohongshu' }, { label: '其他', value: 'other' },
  ] },
  { key: 'plannedAt', label: '计划日期', type: 'date', required: true },
  { key: 'status', label: '状态', type: 'select', options: [
    { label: '计划中', value: 'planned' }, { label: '已发布', value: 'published' }, { label: '错过', value: 'missed' }, { label: '取消', value: 'cancelled' },
  ] },
  { key: 'note', label: '备注', span: 2 },
]
async function addThreeD(v: Record<string, unknown>) {
  try {
    await threeDProjectsRepo.insert({
      name: String(v.name), tool: String(v.tool || 'other'), category: String(v.category || 'model'),
      status: String(v.status || 'planning'), path: String(v.path || ''), note: String(v.note || ''),
    })
    message.success('3D 项目已记录'); load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function addPortfolio(v: Record<string, unknown>) {
  try {
    await portfoliosRepo.insert({
      title: String(v.title), category: String(v.category || 'code'), url: String(v.url || ''),
      path: String(v.path || ''), status: String(v.status || 'draft'), note: String(v.note || ''),
    })
    message.success('作品已记录'); load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function addContent(v: Record<string, unknown>) {
  try {
    await contentCalendarsRepo.insert({
      title: String(v.title), platform: String(v.platform || 'other'), plannedAt: String(v.plannedAt),
      status: String(v.status || 'planned'), note: String(v.note || ''),
    })
    message.success('内容已排期'); load()
  } catch { message.error('保存失败（请通过 npm run tauri dev 启动）') }
}
async function removeThreeD(t: ThreeDProject) {
  const ok = await confirm({ title: '删除 3D 项目？', content: `「${t.name}」${t.tool || '未填工具'}，删除后无法恢复。` })
  if (!ok) return
  try { await threeDProjectsRepo.remove(t.id); load() } catch { /* ignore */ }
}
async function removePortfolio(p: Portfolio) {
  const ok = await confirm({ title: '删除作品？', content: `「${p.title}」${p.category}，删除后无法恢复。` })
  if (!ok) return
  try { await portfoliosRepo.remove(p.id); load() } catch { /* ignore */ }
}
async function removeContent(c: ContentCalendar) {
  const ok = await confirm({ title: '删除内容排期？', content: `「${c.title}」${c.platform}，计划于 ${c.plannedAt}。` })
  if (!ok) return
  try { await contentCalendarsRepo.remove(c.id); load() } catch { /* ignore */ }
}

// ---- F-KNW-04 实体双链 + 关联图视图 ----
type GraphNode = { id: string; label: string; group: string }
type GraphEdge = { from: string; to: string; label?: string }
const graphNodes = computed<GraphNode[]>(() => {
  const ns: GraphNode[] = [
    ...pitfalls.value.map((p) => ({ id: `pitfall:${p.id}`, label: p.title, group: 'pitfall' })),
    ...links.value.map((r) => ({ id: `resource:${r.id}`, label: r.title, group: 'resource' })),
    ...decisions.value.map((d) => ({ id: `decision:${d.id}`, label: d.title, group: 'decision' })),
    ...skillNodes.value.map((s) => ({ id: `skill:${s.id}`, label: s.name, group: 'skill' })),
  ]
  return ns.slice(0, 60)
})
// 节点已截断到 60，边也须同步过滤：否则上千条边会生成上千个 <line>
// 塞进 v-html，而这些边的端点根本不在渲染出的节点里。
const graphEdges = computed<GraphEdge[]>(() => {
  const visible = new Set(graphNodes.value.map((n) => n.id))
  return allLinks.value
    .map((l) => ({ from: `${l.fromType}:${l.fromId}`, to: `${l.toType}:${l.toId}`, label: l.label || '' }))
    .filter((e) => visible.has(e.from) && visible.has(e.to))
    .slice(0, 200)
})
const graphHtml = computed(() => {
  const nodes = graphNodes.value
  const edges = graphEdges.value
  if (!nodes.length) return '<p class="dim">暂无关联数据，先在踩坑/资源/决策中登记内容</p>'
  const cx = 260, cy = 140, R = 120
  const pos = new Map<string, { x: number; y: number }>()
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2
    pos.set(n.id, { x: cx + Math.cos(angle) * R, y: cy + Math.sin(angle) * R })
  })
  const edgeLines = edges
    .filter((e) => pos.has(e.from) && pos.has(e.to))
    .map((e) => {
      const a = pos.get(e.from)!, b = pos.get(e.to)!
      return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" style="stroke: var(--wb-text-3)" stroke-width="1.2" opacity="0.55"/>`
    })
    .join('')
  const colorOf: Record<string, string> = { pitfall: '#ef4444', resource: '#3b82f6', decision: '#8b5cf6', skill: '#10b981' }
  const nodeCircles = nodes
    .map((n) => {
      const p = pos.get(n.id)!
      const c = colorOf[n.group] || '#64748b'
      return `<g><circle cx="${p.x}" cy="${p.y}" r="14" fill="${c}" opacity="0.9"/><text x="${p.x}" y="${p.y + 3}" text-anchor="middle" font-size="8" fill="#fff">${n.label.slice(0, 4)}</text></g>`
    })
    .join('')
  const labels = nodes
    .map((n) => {
      const p = pos.get(n.id)!
      return `<text x="${p.x}" y="${p.y + 26}" text-anchor="middle" font-size="10" style="fill: var(--wb-text-2); pointer-events:none">${n.label.slice(0, 12)}</text>`
    })
    .join('')
  return `<svg viewBox="0 0 520 280" width="100%" height="280">${edgeLines}${nodeCircles}${labels}</svg>`
})

// ---- 批量入库 + 自动分类入库 ----
const AUTO_CLASSIFY_KEYWORDS: Record<string, string[]> = {
  前端: ['vue', 'react', 'css', 'js', '前端', '页面', '组件'],
  后端: ['rust', 'tauri', '后端', '接口', 'server', '服务', 'go', 'java'],
  数据库: ['sql', '数据库', '表', '查询', '索引'],
  运维: ['部署', '运维', 'docker', 'k8s', 'nginx', '服务器', '备份'],
  工具: ['工具', '插件', '快捷键', 'vscode'],
}
function autoClassify(text: string): string {
  for (const [cat, keys] of Object.entries(AUTO_CLASSIFY_KEYWORDS)) {
    if (keys.some((k) => text.toLowerCase().includes(k))) return cat
  }
  return '其他'
}
const batchKindLabel = (k: 'pitfall' | 'resource') => (k === 'pitfall' ? '踩坑' : '资源链接')
async function addBatch() {
  const lines = batchText.value.split('\n').map((s) => s.trim()).filter(Boolean)
  if (!lines.length) { message.warning('请先粘贴内容（每行一条）'); return }
  let ok = 0
  for (const line of lines) {
    try {
      if (batchKind.value === 'pitfall') {
        await pitfallsRepo.insert({ title: line.slice(0, 80), category: autoClassify(line), problem: line, solution: '' })
      } else {
        const urlMatch = line.match(/https?:\/\/\S+/)
        const title = urlMatch ? line.replace(urlMatch[0], '').trim() || urlMatch[0] : line
        await resourcesRepo.insert({ title: title.slice(0, 80), url: urlMatch ? urlMatch[0] : '', category: 'favorite', note: line })
      }
      ok++
    } catch { /* 单条失败继续 */ }
  }
  message.success(`批量入库完成：${ok}/${lines.length} 条${batchKind.value === 'pitfall' ? '（已自动分类）' : ''}`)
  batchText.value = ''
  batchFormShow.value = false
  load()
}
// ---- 快照 / 分享 ----
async function exportSnapshot() {
  const snap = {
    version: 1,
    exportedAt: new Date().toISOString(),
    pitfalls: pitfalls.value, resources: links.value, decisions: decisions.value,
    skills: skillNodes.value, paths: paths.value,
  }
  try {
    await navigator.clipboard.writeText(JSON.stringify(snap, null, 2))
    message.success('知识库快照已复制到剪贴板（JSON）')
  } catch { message.error('复制失败') }
}
async function shareSnapshot() {
  try {
    const text = `【WORKBENCH 知识库分享】\n踩坑 ${pitfalls.value.length} 条 · 资源 ${links.value.length} 条 · 决策 ${decisions.value.length} 条\n\n${pitfalls.value.slice(0, 10).map((p) => `· ${p.title}（${p.category}）`).join('\n')}`
    await navigator.clipboard.writeText(text)
    message.success('分享摘要已复制')
  } catch { message.error('复制失败') }
}
</script>

<template>
  <div>

    <n-tabs type="line" class="wb-tabs">
      <!-- 踩坑库 -->
      <n-tab-pane name="pitfalls" tab="踩坑库">
        <div class="toolbar">
          <NInput v-model:value="keyword" size="small" placeholder="搜索踩坑记录…" clearable style="width: 240px" />
          <NButton size="small" type="primary" ghost @click="pitfallFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            记录踩坑
          </NButton>
        </div>
        <div v-if="filteredPitfalls.length" class="pitfall-list">
          <div v-for="p in filteredPitfalls" :key="p.id" class="pitfall-card wb-card">
            <div class="pc-head">
              <span class="pc-title"><NIcon :component="AlertTriangle" style="color: var(--wb-warning); margin-right: 7px" />{{ p.title }}</span>
              <NTag size="tiny" :bordered="false" type="warning">{{ p.category }}</NTag>
            </div>
            <div v-if="p.problem" class="pc-problem">
              <span class="pc-label">问题</span>{{ p.problem }}
            </div>
            <div v-if="p.solution" class="pc-solution">
              <span class="pc-label">解决</span>{{ p.solution }}
            </div>
            <div class="pc-foot">
              <span v-if="p.tags" class="mono pc-tags">{{ p.tags }}</span>
              <span class="mono pc-date">{{ p.updatedAt || p.createdAt }}</span>
              <NButton size="tiny" text type="error" @click="removePitfall(p)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </div>
          </div>
        </div>
        <EmptyState v-else text="暂无踩坑记录，掉过的坑记下来" />
      </n-tab-pane>

      <!-- 学习资源 -->
      <n-tab-pane name="links" tab="学习资源">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="linkFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            收藏链接
          </NButton>
        </div>
        <div v-if="links.length" class="link-list">
          <div v-for="l in links" :key="l.id" class="link-item wb-card hoverable" @click="openLink(l)">
            <div class="link-main">
              <span class="link-title">{{ l.title }}</span>
              <span class="mono link-url">{{ l.url }}</span>
            </div>
            <div class="link-side">
              <NTag size="tiny" :bordered="false" :type="linkColor(l.category) as any">{{ l.category }}</NTag>
              <NButton size="tiny" quaternary circle @click.stop="openLink(l)" title="打开">
                <template #icon><NIcon :component="ExternalLink" /></template>
              </NButton>
              <NButton size="tiny" quaternary circle type="error" @click.stop="removeLink(l)" title="删除">
                <template #icon><NIcon :component="Trash" /></template>
              </NButton>
            </div>
          </div>
        </div>
        <EmptyState v-else text="暂无收藏链接" />
      </n-tab-pane>

      <!-- 素材索引 -->
      <n-tab-pane name="assets" tab="素材索引">
        <div class="toolbar">
          <NInput v-model:value="assetRoot" size="small" placeholder="扫描根目录…" clearable style="width: 260px" />
          <NButton size="small" type="primary" ghost :loading="assetLoading" @click="runAssets()">
            <template #icon><NIcon :component="Refresh" /></template>
            扫描
          </NButton>
        </div>
        <div v-if="assetGroups.length" class="asset-section">
          <section v-for="g in assetGroups" :key="g.category" class="asset-group">
            <header class="ag-head">
              <span class="ag-title">{{ CATEGORY_LABEL[g.category] }}</span>
              <span class="mono ag-count">{{ g.items.length }}</span>
            </header>
            <div class="asset-list">
              <div v-for="(a, i) in g.items.slice(0, 24)" :key="`${a.path}-${i}`" class="asset-item wb-card">
                <div class="ai-head">
                  <span class="ai-name">{{ a.name }}</span>
                  <NTag size="tiny" :bordered="false" :type="categoryColor(a.category)">{{ a.ext }}</NTag>
                </div>
                <div class="ai-path mono">{{ a.path }}</div>
                <div class="ai-meta mono">
                  <span>{{ fmtSize(a.size) }}</span>
                  <span>{{ new Date(a.modified * 1000).toLocaleDateString() }}</span>
                </div>
              </div>
            </div>
          </section>
        </div>
        <EmptyState v-else :text="assetLoading ? '扫描中…' : '暂无素材索引（仅 Tauri 环境可用）'" />
      </n-tab-pane>

      <!-- 复习计划 -->
      <n-tab-pane name="review" tab="复习计划">
        <div class="review-head">
          <span>间隔复习：1 → 3 → 7 → 14 → 30 天逐步巩固，到期条目自动出现在这里</span>
        </div>
        <div v-if="reviewItems.length" class="review-list">
          <div v-for="r in reviewItems" :key="`${r.kind}-${r.id}`" class="review-item wb-card">
            <div class="rv-main">
              <div class="rv-title">
                <NTag size="tiny" :bordered="false" :type="r.kind === 'pitfall' ? 'error' : 'info'" style="margin-right: 8px">
                  {{ r.kind === 'pitfall' ? '踩坑' : '资源' }}
                </NTag>
                <span>{{ r.title }}</span>
              </div>
              <div class="rv-meta mono">
                到期：{{ new Date(r.due).toLocaleDateString() }} · 复习 {{ r.progress }}/5
              </div>
            </div>
            <NButton size="small" type="primary" ghost @click="markReviewed(r.kind, r.id)">
              <template #icon><NIcon :component="Refresh" /></template>
              标记复习
            </NButton>
          </div>
        </div>
        <EmptyState v-else text="当前无到期复习条目，保持节奏" />
      </n-tab-pane>

      <!-- 决策日志 F-KNW-02 -->
      <n-tab-pane name="decisions" tab="决策日志">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="decisionFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            记录决策
          </NButton>
        </div>
        <div v-if="decisions.length" class="link-list">
          <div v-for="d in decisions" :key="d.id" class="link-item wb-card">
            <div class="link-main">
              <span class="link-title">{{ d.title }}</span>
              <span v-if="d.context" class="mono link-url">背景：{{ d.context }}</span>
              <span v-if="d.decision" class="pc-solution">{{ d.decision }}</span>
            </div>
            <div class="link-side">
              <NTag size="tiny" :bordered="false" :type="decisionStatus(d).color">{{ decisionStatus(d).label }}</NTag>
              <span class="mono" style="font-size: 10.5px; color: var(--wb-text-3)">{{ d.decidedAt || (d.createdAt || '').slice(0, 10) }}</span>
              <NButton size="tiny" quaternary circle type="error" @click="removeDecision(d)">
                <template #icon><NIcon :component="Trash" /></template>
              </NButton>
            </div>
          </div>
        </div>
        <EmptyState v-else text="暂无决策记录，重大选择留痕" />
      </n-tab-pane>

      <!-- 技能树 F-KNW-05 -->
      <n-tab-pane name="skills" tab="技能树">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="skillFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            添加技能
          </NButton>
        </div>
        <div class="st-wrap" v-html="skillTreeHtml"></div>
        <EmptyState v-if="!skillNodes.length" text="暂无技能节点，规划你的技能树" />
      </n-tab-pane>

      <!-- 学习路径 F-KNW-06 -->
      <n-tab-pane name="paths" tab="学习路径">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="pathFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            添加步骤
          </NButton>
        </div>
        <div v-if="paths.length" class="review-list">
          <div v-for="p in [...paths].sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0))" :key="p.id" class="review-item wb-card">
            <div class="rv-main">
              <div class="rv-title">
                <NTag size="tiny" :bordered="false" :type="p.status === 'done' ? 'success' : p.status === 'doing' ? 'info' : 'default'" style="margin-right: 8px">
                  {{ p.status === 'done' ? '已完成' : p.status === 'doing' ? '进行中' : '待开始' }}
                </NTag>
                <span>步骤 {{ p.step }}：{{ p.title }}</span>
              </div>
              <div v-if="p.goal" class="rv-meta">{{ p.goal }}</div>
              <div v-if="p.resource" class="mono rv-meta">资源：{{ p.resource }}</div>
            </div>
            <div style="display: flex; gap: 6px">
              <NButton size="small" @click="togglePathStatus(p)">
                {{ p.status === 'todo' ? '开始' : p.status === 'doing' ? '完成' : '重置' }}
              </NButton>
              <NButton size="small" quaternary circle type="error" @click="removePath(p)">
                <template #icon><NIcon :component="Trash" /></template>
              </NButton>
            </div>
          </div>
        </div>
        <EmptyState v-else text="暂无学习路径，拆解你的学习目标" />
      </n-tab-pane>

      <!-- 创作台账 F-KNW-08/09/10 -->
      <n-tab-pane name="creation" tab="创作台账">
        <div class="creation-block">
          <header class="cb-head"><span>3D 项目台账（F-KNW-08）</span>
            <NButton size="tiny" type="primary" ghost @click="threeDFormShow = true"><template #icon><NIcon :component="Plus" /></template>新增</NButton>
          </header>
          <div v-if="threeD.length" class="review-list">
            <div v-for="t in threeD" :key="t.id" class="review-item wb-card">
              <div class="rv-main">
                <div class="rv-title">{{ t.name }}
                  <NTag size="tiny" :bordered="false" style="margin-left: 8px">{{ t.tool }}</NTag>
                  <NTag size="tiny" :bordered="false" type="warning" style="margin-left: 4px">{{ t.category }}</NTag>
                </div>
                <div class="mono rv-meta">{{ t.path || '未指定路径' }} · {{ t.status }}</div>
              </div>
              <NButton size="tiny" quaternary circle type="error" @click="removeThreeD(t)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </div>
          </div>
          <EmptyState v-if="!threeD.length" text="暂无 3D 项目" />
        </div>
        <div class="creation-block" style="margin-top: 14px">
          <header class="cb-head"><span>作品集（F-KNW-09）</span>
            <NButton size="tiny" type="primary" ghost @click="portfolioFormShow = true"><template #icon><NIcon :component="Plus" /></template>新增</NButton>
          </header>
          <div v-if="portfolios.length" class="review-list">
            <div v-for="p in portfolios" :key="p.id" class="review-item wb-card">
              <div class="rv-main">
                <div class="rv-title">{{ p.title }}
                  <NTag size="tiny" :bordered="false" style="margin-left: 8px">{{ p.category }}</NTag>
                </div>
                <div class="mono rv-meta">{{ p.url || p.path || '—' }} · {{ p.status }}</div>
              </div>
              <NButton size="tiny" quaternary circle type="error" @click="removePortfolio(p)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </div>
          </div>
          <EmptyState v-if="!portfolios.length" text="暂无作品记录" />
        </div>
        <div class="creation-block" style="margin-top: 14px">
          <header class="cb-head"><span>内容日历（F-KNW-10）</span>
            <NButton size="tiny" type="primary" ghost @click="contentFormShow = true"><template #icon><NIcon :component="Plus" /></template>新增</NButton>
          </header>
          <div v-if="contentCal.length" class="review-list">
            <div v-for="c in [...contentCal].sort((a, b) => (a.plannedAt || '').localeCompare(b.plannedAt || ''))" :key="c.id" class="review-item wb-card">
              <div class="rv-main">
                <div class="rv-title">{{ c.title }}
                  <NTag size="tiny" :bordered="false" style="margin-left: 8px">{{ c.platform }}</NTag>
                </div>
                <div class="mono rv-meta">计划 {{ c.plannedAt }} · {{ c.status }}</div>
              </div>
              <NButton size="tiny" quaternary circle type="error" @click="removeContent(c)"><template #icon><NIcon :component="Trash" /></template></NButton>
            </div>
          </div>
          <EmptyState v-if="!contentCal.length" text="暂无内容排期" />
        </div>
      </n-tab-pane>

      <!-- 关联图 F-KNW-04 -->
      <n-tab-pane name="graph" tab="关联图">
        <div class="toolbar">
          <span class="review-head" style="margin: 0">实体双向链接：踩坑 / 资源 / 决策 / 技能 自动成图，用 links 表维护关联</span>
        </div>
        <div class="graph-wrap wb-card" v-html="graphHtml"></div>
        <div v-if="allLinks.length" class="link-list" style="margin-top: 12px">
          <div v-for="(l, i) in allLinks.slice(0, 20)" :key="i" class="link-item wb-card">
            <span class="mono" style="font-size: 11px">{{ l.fromType }}#{{ l.fromId }} → {{ l.toType }}#{{ l.toId }}<span v-if="l.label">（{{ l.label }}）</span></span>
          </div>
        </div>
      </n-tab-pane>

      <!-- 批量入库 / 快照 -->
      <n-tab-pane name="batch" tab="批量入库">
        <div class="toolbar">
          <NButton size="small" type="primary" ghost @click="batchFormShow = true">
            <template #icon><NIcon :component="Plus" /></template>
            批量入库
          </NButton>
          <div style="display: flex; gap: 6px">
            <NButton size="small" ghost @click="exportSnapshot()">快照导出</NButton>
            <NButton size="small" ghost @click="shareSnapshot()">分享摘要</NButton>
          </div>
        </div>
        <div class="review-head">每行一条：踩坑自动分类入库（按关键词归入前端/后端/数据库/运维/工具/其他），资源自动提取 URL。</div>
        <div class="st-wrap">
          <p class="dim">当前知识库：踩坑 {{ pitfalls.length }} 条 · 资源 {{ links.length }} 条 · 决策 {{ decisions.length }} 条 · 技能 {{ skillNodes.length }} 节点 · 路径 {{ paths.length }} 步</p>
        </div>
      </n-tab-pane>
    </n-tabs>

    <ModalForm v-model:show="pitfallFormShow" title="记录踩坑" :fields="pitfallFields" confirm-text="保存" @submit="addPitfall" />
    <ModalForm v-model:show="linkFormShow" title="收藏链接" :fields="linkFields" @submit="addLink" />
    <ModalForm v-model:show="decisionFormShow" title="记录决策" :fields="decisionFields" confirm-text="保存" @submit="addDecision" />
    <ModalForm v-model:show="skillFormShow" title="添加技能节点" :fields="skillFields" confirm-text="保存" @submit="addSkill" />
    <ModalForm v-model:show="pathFormShow" title="添加学习路径步骤" :fields="pathFields" confirm-text="保存" @submit="addPath" />
    <ModalForm v-model:show="threeDFormShow" title="新增 3D 项目" :fields="threeDFields" confirm-text="保存" @submit="addThreeD" />
    <ModalForm v-model:show="portfolioFormShow" title="新增作品" :fields="portfolioFields" confirm-text="保存" @submit="addPortfolio" />
    <ModalForm v-model:show="contentFormShow" title="新增内容排期" :fields="contentFields" confirm-text="保存" @submit="addContent" />
    <ModalForm v-model:show="batchFormShow" title="批量入库" confirm-text="导入">
      <template #default>
        <div style="display: flex; gap: 6px; margin-bottom: 8px">
          <NButton size="tiny" :type="batchKind === 'pitfall' ? 'primary' : 'default'" @click="batchKind = 'pitfall'">踩坑</NButton>
          <NButton size="tiny" :type="batchKind === 'resource' ? 'primary' : 'default'" @click="batchKind = 'resource'">资源链接</NButton>
        </div>
        <NInput v-model:value="batchText" type="textarea" :rows="8" placeholder="每行一条，例如：&#10;tauri 窗口创建失败报 missing-icons，需要先 build 生成图标资源&#10;https://vuejs.org Vue 官方文档" />
      </template>
    </ModalForm>
  </div>
</template>

<style scoped>
.wb-tabs :deep(.n-tabs-nav) { margin-bottom: 14px; }
.toolbar { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
.pitfall-list { display: flex; flex-direction: column; gap: 10px; }
.pitfall-card { padding: 13px 16px; }
.pc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.pc-title { font-size: 13.5px; font-weight: 600; display: flex; align-items: center; }
.pc-problem, .pc-solution {
  margin-top: 7px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--wb-text-2);
}
.pc-label {
  display: inline-block;
  font-size: 10.5px;
  font-weight: 700;
  margin-right: 6px;
  padding: 1px 5px;
  border-radius: 4px;
}
.pc-problem .pc-label { background: color-mix(in srgb, var(--wb-warning) 16%, transparent); color: var(--wb-warning); }
.pc-solution .pc-label { background: color-mix(in srgb, var(--wb-success) 16%, transparent); color: var(--wb-success); }
.pc-foot { display: flex; align-items: center; gap: 10px; margin-top: 9px; }
.pc-tags { font-size: 11px; color: var(--wb-module-knowledge); flex: 1; }
.pc-date { font-size: 10.5px; color: var(--wb-text-3); }
.link-list { display: flex; flex-direction: column; gap: 8px; }
.link-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  cursor: pointer;
}
.link-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.link-title { font-size: 13px; font-weight: 550; }
.link-url { font-size: 11px; color: var(--wb-text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link-side { display: flex; align-items: center; gap: 4px; flex: none; }
.asset-section { display: flex; flex-direction: column; gap: 16px; }
.asset-group { display: flex; flex-direction: column; gap: 8px; }
.ag-head { display: flex; align-items: center; gap: 8px; }
.ag-title { font-size: 13px; font-weight: 600; }
.ag-count { font-size: 11px; color: var(--wb-text-3); }
.asset-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
.asset-item { padding: 10px 12px; }
.ai-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ai-name { font-size: 12.5px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-path { font-size: 11px; color: var(--wb-text-3); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-meta { display: flex; justify-content: space-between; font-size: 10.5px; color: var(--wb-text-3); margin-top: 5px; }
.review-head { margin-bottom: 12px; font-size: 12px; color: var(--wb-text-3); }
.review-list { display: flex; flex-direction: column; gap: 10px; }
.review-item { padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.rv-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.rv-title { display: flex; align-items: center; font-size: 13px; font-weight: 600; }
.rv-meta { font-size: 11px; color: var(--wb-text-3); }
.st-wrap { background: var(--wb-card-bg); border: 1px solid var(--wb-border); border-radius: var(--wb-radius-md); padding: 14px; }
.st-tree { display: flex; flex-direction: column; gap: 6px; }
.st-node { display: flex; align-items: center; gap: 7px; font-size: 12.5px; padding: 4px 0; }
.st-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
.st-dot[data-st='mastered'] { background: var(--wb-success); }
.st-dot[data-st='learning'] { background: var(--wb-info, #2080f0); }
.st-dot[data-st='todo'] { background: var(--wb-text-3); }
.st-meta { font-size: 10.5px; color: var(--wb-text-3); margin-left: 6px; }
.creation-block { display: flex; flex-direction: column; gap: 8px; }
.cb-head { display: flex; align-items: center; justify-content: space-between; font-size: 13px; font-weight: 600; margin-bottom: 2px; }
.graph-wrap { padding: 10px; overflow: hidden; }
.dim { color: var(--wb-text-3); font-size: 12px; }
</style>
