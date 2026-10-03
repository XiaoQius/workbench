<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { usePaletteStore } from '@/stores/palette'
import { useThemeStore } from '@/stores/theme'
import { modules, moduleColor } from '@/theme/tokens'
import type { ModuleKey } from '@/theme/tokens'
import { projectsRepo, tasksRepo, snippetsRepo, serversRepo, domainsRepo, notesRepo, toolsRepo, ledgerRepo, inspirationsRepo } from '@/db'
import { refreshTick } from '@/stores/ui'
import { parseInspiration } from '@/composables/inspiration'

interface Command {
  id: string
  label: string
  hint: string
  group: string
  color: string
  run: () => void
  meta?: { type?: string; status?: string; tags?: string; dueDate?: string; scope?: string }
}

// ---- 搜索语法（F-SYS-05）：type: / status: / tag: / due: / scope: 结构化过滤 ----
interface ParsedQuery {
  plain: string
  type?: string
  status?: string
  tag?: string
  due?: string
  scope?: string
}

function parseQuery(raw: string): ParsedQuery {
  const out: ParsedQuery = { plain: raw.trim().toLowerCase() }
  const tokens = raw.trim().split(/\s+/)
  const rest: string[] = []
  for (const t of tokens) {
    const m = t.match(/^(type|status|tag|due|scope):(.+)$/i)
    if (m) {
      const key = m[1].toLowerCase()
      const val = m[2].toLowerCase()
      if (key === 'type') out.type = val
      else if (key === 'status') out.status = val
      else if (key === 'tag') out.tag = val
      else if (key === 'due') out.due = val
      else if (key === 'scope') out.scope = val
    } else {
      rest.push(t.toLowerCase())
    }
  }
  out.plain = rest.join(' ')
  return out
}

function dueMatch(due?: string, rule?: string): boolean {
  if (!rule) return true
  if (!due) return false
  const m = rule.match(/^<(\d+)d$/)
  if (!m) return due.includes(rule)
  const days = Number(m[1])
  const diff = Math.ceil((new Date(due + 'T00:00:00').getTime() - Date.now()) / 86400000)
  return diff <= days
}

const searchSyntaxHint = '支持语法：type:项目 status:todo tag:重点 due:<7d scope:dev'

const router = useRouter()
const paletteStore = usePaletteStore()
const themeStore = useThemeStore()
const message = useMessage()

const query = ref('')
const activeIdx = ref(0)
const listEl = ref<HTMLElement | null>(null)

const baseCommands = computed<Command[]>(() => {
  const cmds: Command[] = [
    ...modules.map((m) => ({
      id: `go:${m.key}`,
      label: `前往 ${m.label}`,
      hint: m.path,
      group: '页面模块',
      color: moduleColor(m.key, themeStore.dark),
      run: () => router.push(m.path),
    })),
    {
      id: 'theme:toggle',
      label: themeStore.dark ? '切换为浅色主题' : '切换为深色主题',
      hint: 'Ctrl+Shift+D',
      group: '全局',
      color: moduleColor('home', themeStore.dark),
      run: () => themeStore.toggle(),
    },
    {
      id: 'shortcuts',
      label: '查看快捷键',
      hint: 'Ctrl+K / Ctrl+1..8',
      group: '全局',
      color: moduleColor('knowledge', themeStore.dark),
      run: () => router.push('/'),
    },
  ]
  // 「灵感: xxx」即时动作：输入前缀即可直接捕获，不用进灵感页
  const mInsp = /灵感[:：]\s*(.+)$/.exec(query.value.trim())
  if (mInsp) {
    cmds.unshift({
      id: 'insp:capture',
      label: `记灵感：${mInsp[1].trim()}`,
      hint: '回车即存，支持 #标签',
      group: '新建',
      color: moduleColor('inspiration', themeStore.dark),
      run: async () => {
        await quickCaptureInspiration(mInsp[1].trim())
        message.success('灵感已记录')
        router.push('/inspiration')
      },
    })
  }
  return cmds
})

// 各模块的“新建”动作：跳转到对应模块
const createActions: Array<{ key: ModuleKey; label: string }> = [
  { key: 'workspace', label: '新建工具启动项' },
  { key: 'dev', label: '新建项目' },
  { key: 'dev', label: '新建任务' },
  { key: 'dev', label: '新建代码片段' },
  { key: 'ops', label: '新建服务器' },
  { key: 'ops', label: '新建域名' },
  { key: 'life', label: '新建习惯' },
  { key: 'life', label: '记一笔账' },
  { key: 'study', label: '新建课程' },
  { key: 'study', label: '新建作业' },
  { key: 'study', label: '新建笔记' },
  { key: 'knowledge', label: '记录踩坑' },
  { key: 'knowledge', label: '收藏链接' },
  { key: 'inspiration', label: '记灵感' },
]

async function quickCaptureInspiration(text: string) {
  const { content, tags } = parseInspiration(text)
  if (!content && !tags) return
  try {
    await inspirationsRepo.insert({ content: content || text, tags: tags || null })
  } catch {
    /* 浏览器降级：数据层不可用时静默失败，由列表页提示 */
  }
}

const createCommands = computed<Command[]>(() =>
  createActions.map((a, i) => {
    const m = modules.find((x) => x.key === a.key)!
    return {
      id: `create:${i}`,
      label: a.label,
      hint: m.label,
      group: '新建',
      color: moduleColor(a.key, themeStore.dark),
      run: () => router.push(m.path),
    }
  }),
)

const all = computed(() => {
  const pq = parseQuery(query.value)
  const src = [...baseCommands.value, ...createCommands.value, ...dataCommands.value]
  const hasSyntax = !!(pq.type || pq.status || pq.tag || pq.due || pq.scope)
  const hasPlain = !!pq.plain
  if (!hasSyntax && !hasPlain) return src
  return src.filter((c) => {
    const plainOk = !hasPlain || c.label.toLowerCase().includes(pq.plain) || c.hint.toLowerCase().includes(pq.plain) || c.group.toLowerCase().includes(pq.plain)
    if (!plainOk) return false
    if (hasSyntax) {
      const m = c.meta || {}
      if (pq.type && !c.label.toLowerCase().includes(`· ${pq.type}`) && !(m.type || '').toLowerCase().includes(pq.type)) return false
      if (pq.status && !(m.status || '').toLowerCase().includes(pq.status)) return false
      if (pq.tag && !(m.tags || '').toLowerCase().includes(pq.tag)) return false
      if (pq.due && !dueMatch(m.dueDate, pq.due)) return false
      if (pq.scope && !(m.scope || c.group).toLowerCase().includes(pq.scope)) return false
    }
    return true
  })
})

// ---- 跨表数据搜索（F-SYS-01）：打开时加载关键表为可执行命令 ----
const dataCommands = ref<Command[]>([])

const DATA_SOURCES: Array<{ key: ModuleKey; label: string; load: () => Promise<{ id: number; name: string; sub: string; meta?: Command['meta'] }[]> }> = [
  { key: 'dev', label: '项目', load: () => projectsRepo.listAll().then((rs) => rs.map((r: any) => ({ id: r.id, name: r.name, sub: r.status || '', meta: { type: '项目', status: r.status || '', scope: 'dev' } }))) },
  { key: 'dev', label: '任务', load: () => tasksRepo.listAll().then((rs) => rs.map((r: any) => ({ id: r.id, name: r.title, sub: r.status || '', meta: { type: '任务', status: r.status || '', scope: r.scope || 'dev', dueDate: r.dueDate || undefined } }))) },
  { key: 'dev', label: '代码片段', load: () => snippetsRepo.listAll().then((rs) => rs.map((r: any) => ({ id: r.id, name: r.title, sub: r.language || '', meta: { type: '代码片段', tags: (r.tags || '').toLowerCase(), scope: 'dev' } }))) },
  { key: 'ops', label: '服务器', load: () => serversRepo.listAll().then((rs) => rs.map((r: any) => ({ id: r.id, name: r.name, sub: r.ip || '', meta: { type: '服务器', status: r.status || '', scope: 'ops' } }))) },
  { key: 'ops', label: '域名', load: () => domainsRepo.listAll().then((rs) => rs.map((r: any) => ({ id: r.id, name: r.name, sub: r.registrar || '', meta: { type: '域名', scope: 'ops' } }))) },
  { key: 'study', label: '笔记', load: () => notesRepo.listAll().then((rs) => rs.map((r: any) => ({ id: r.id, name: r.title, sub: (r.tags || '').slice(0, 40), meta: { type: '笔记', tags: (r.tags || '').toLowerCase(), scope: 'study' } }))) },
  { key: 'workspace', label: '工具', load: () => toolsRepo.listAll().then((rs) => rs.map((r: any) => ({ id: r.id, name: r.name, sub: r.target || '', meta: { type: '工具', scope: 'workspace' } }))) },
  { key: 'life', label: '账目', load: () => ledgerRepo.listAll().then((rs) => rs.map((r: any) => ({ id: r.id, name: `${r.type === 'income' ? '收' : '支'} ¥${r.amount}`, sub: (r.category || '') + (r.note ? ' · ' + r.note : ''), meta: { type: '账目', tags: (r.category || '').toLowerCase(), scope: 'life' } }))) },
  { key: 'inspiration', label: '灵感', load: () => inspirationsRepo.listAll().then((rs) => rs.map((r: any) => ({ id: r.id, name: (r.content || '').slice(0, 30), sub: (r.tags || '').toLowerCase(), meta: { type: '灵感', tags: (r.tags || '').toLowerCase(), scope: 'inspiration' } }))) },
]

// 每个数据源最多纳入的条数：原先无上限，表一大时每次 Ctrl+K 都全表拉取并
// 生成上千个命令对象，打开即卡住。
const DATA_SOURCE_LIMIT = 50

async function loadDataCommands(force = false) {
  // 缓存：面板频繁开关时不必重复全表拉取
  if (!force && dataCommands.value.length > 0) return
  try {
    const results = await Promise.all(DATA_SOURCES.map((s) => s.load().catch(() => [])))
    dataCommands.value = DATA_SOURCES.flatMap((s, i) => {
      const m = modules.find((x) => x.key === s.key)!
      return results[i].slice(0, DATA_SOURCE_LIMIT).map((r, j) => ({
        id: `data:${s.label}-${j}`,
        label: `${s.label} · ${r.name}`,
        hint: r.sub || m.label,
        group: '数据',
        color: moduleColor(s.key, themeStore.dark),
        meta: r.meta,
        run: () => router.push(m.path),
      }))
    })
  } catch {
    dataCommands.value = []
  }
}

watch(() => paletteStore.open, (open) => {
  if (open) {
    query.value = ''
    activeIdx.value = 0
    loadDataCommands()
    nextTick(scrollActive)
  }
})

// 顶栏「刷新当前页」后让数据命令缓存失效，保证能搜到新增记录
watch(refreshTick, () => {
  dataCommands.value = []
})

watch(all, () => {
  if (activeIdx.value >= all.value.length) activeIdx.value = Math.max(0, all.value.length - 1)
  nextTick(scrollActive)
})

function scrollActive() {
  listEl.value
    ?.querySelector(`[data-idx="${activeIdx.value}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}

function onKeydown(e: KeyboardEvent) {
  if (!paletteStore.open) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIdx.value = (activeIdx.value + 1) % all.value.length
    nextTick(scrollActive)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIdx.value = (activeIdx.value - 1 + all.value.length) % all.value.length
    nextTick(scrollActive)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const cmd = all.value[activeIdx.value]
    if (cmd) {
      paletteStore.close()
      cmd.run()
    }
  }
}

function pick(cmd: Command) {
  paletteStore.close()
  cmd.run()
}

interface CommandGroup {
  name: string
  start: number
  items: Command[]
}
const groups = computed<CommandGroup[]>(() => {
  const map = new Map<string, Command[]>()
  for (const c of all.value) {
    if (!map.has(c.group)) map.set(c.group, [])
    map.get(c.group)!.push(c)
  }
  let start = 0
  const out: CommandGroup[] = []
  for (const [name, items] of map.entries()) {
    out.push({ name, start, items })
    start += items.length
  }
  return out
})
</script>

<template>
  <Teleport to="body">
    <div v-if="paletteStore.open" class="palette-overlay" @click.self="paletteStore.close()" @keydown="onKeydown" tabindex="-1">
      <div class="palette-panel">
        <div class="palette-input">
          <span class="prompt">›</span>
          <input
            v-model="query"
            placeholder="搜索命令 / 模块 / 数据… 支持 type: status: tag: due:<7d scope:"
            autofocus
          />
        </div>
        <div ref="listEl" class="palette-list">
          <template v-for="grp in groups" :key="grp.name">
            <div class="palette-group">{{ grp.name }}</div>
            <div
              v-for="(c, i) in grp.items"
              :key="c.id"
              :data-idx="grp.start + i"
              class="palette-item"
              :class="{ active: grp.start + i === activeIdx }"
              @mouseenter="activeIdx = grp.start + i"
              @click="pick(c)"
            >
              <span class="dot" :style="{ background: c.color }"></span>
              <span class="label">{{ c.label }}</span>
              <span class="hint mono">{{ c.hint }}</span>
            </div>
          </template>
          <div v-if="groups.length === 0" class="empty-wrap">
            <div>没有匹配的命令</div>
          </div>
        </div>
        <div class="palette-footer">
          <span>↑↓ 选择</span><span>↵ 执行</span><span>esc 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.palette-input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--wb-border);
}
.prompt {
  color: var(--wb-accent);
  font-weight: 700;
  font-size: 15px;
}
.palette-input input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--wb-text-1);
  font-size: 14px;
  font-family: var(--wb-font);
}
.palette-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}
.palette-group {
  padding: 6px 10px 3px;
  font-size: 11px;
  color: var(--wb-text-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--wb-radius-sm);
  cursor: pointer;
}
.palette-item.active {
  background: var(--wb-card-alt);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.label {
  flex: 1;
  font-size: 13px;
}
.hint {
  font-size: 11.5px;
  color: var(--wb-text-3);
}
.palette-footer {
  display: flex;
  gap: 14px;
  padding: 8px 16px;
  border-top: 1px solid var(--wb-border);
  font-size: 11px;
  color: var(--wb-text-3);
}
</style>
