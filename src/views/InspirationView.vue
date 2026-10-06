<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { NIcon, NTag, NTooltip, useMessage } from 'naive-ui'
import { Bulb, Star, Search, Trash, MoodSmile, MoodNeutral, MoodSad } from '@vicons/tabler'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import ListSkeleton from '@/components/ListSkeleton.vue'
import { inspirationsRepo } from '@/db'
import type { Inspiration } from '../../drizzle/schema'
import { parseInspiration } from '@/composables/inspiration'
import { useConfirm } from '@/composables/useConfirm'
import { refreshTick } from '@/stores/ui'
import { useListNav } from '@/composables/useListNav'

const message = useMessage()
const { confirm } = useConfirm()

// ---- 快速记录：输入框是灵魂，回车即存、清空、保持焦点 ----
const draft = ref('')
const moodDraft = ref<string | null>(null)
const inputEl = ref<{ focus: () => void } | null>(null)
const saving = ref(false)

const MOODS = [
  { key: 'good', label: '好主意', icon: MoodSmile },
  { key: 'neutral', label: '一般的', icon: MoodNeutral },
  { key: 'bad', label: '待商榷', icon: MoodSad },
] as const

async function saveDraft() {
  const raw = draft.value.trim()
  if (!raw || saving.value) return
  const { content, tags } = parseInspiration(raw)
  if (!content && !tags) return
  saving.value = true
  try {
    await inspirationsRepo.insert({
      content: content || raw,
      tags: tags || null,
      mood: moodDraft.value,
      starred: 0,
    })
    draft.value = ''
    moodDraft.value = null
    await load()
  } catch {
    message.error('保存失败：数据层不可用')
  } finally {
    saving.value = false
    nextTick(() => inputEl.value?.focus())
  }
}

// ---- 列表 ----
const rows = ref<Inspiration[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    rows.value = await inspirationsRepo.list()
  } catch {
    rows.value = [] // 浏览器预览降级：DB 不可用时显示空列表
  } finally {
    loading.value = false
  }
}

// 星标置顶，其余按创建时间倒序（repo.list 已按 id 倒序）
const sorted = computed(() => [...rows.value].sort((a, b) => (b.starred - a.starred)))

const keyword = ref('')
const tagFilter = ref<string | null>(null)

const allTags = computed(() => {
  const set = new Map<string, number>()
  for (const r of rows.value) {
    for (const t of (r.tags || '').split(',').map((x) => x.trim()).filter(Boolean)) {
      set.set(t, (set.get(t) || 0) + 1)
    }
  }
  return [...set.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ tag: t, count: n }))
})

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return sorted.value.filter((r) => {
    if (tagFilter.value && !(r.tags || '').split(',').map((x) => x.trim()).includes(tagFilter.value)) return false
    if (kw && !r.content.toLowerCase().includes(kw) && !(r.tags || '').toLowerCase().includes(kw)) return false
    return true
  })
})

async function toggleStar(r: Inspiration) {
  try {
    await inspirationsRepo.update(r.id, { starred: r.starred ? 0 : 1 })
    r.starred = r.starred ? 0 : 1
  } catch {
    message.error('操作失败')
  }
}

async function remove(r: Inspiration) {
  const ok = await confirm({ title: '删除这条灵感？', content: r.content.length > 40 ? `${r.content.slice(0, 40)}…` : r.content })
  if (!ok) return
  try {
    await inspirationsRepo.remove(r.id)
    rows.value = rows.value.filter((x) => x.id !== r.id)
  } catch {
    message.error('删除失败')
  }
}

function fmtTime(s: string | null): string {
  if (!s) return ''
  const d = new Date(s.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return s
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  if (diff < 6 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`
  return s.slice(0, 10)
}

watch(refreshTick, () => load())
onMounted(() => {
  load()
  nextTick(() => inputEl.value?.focus())
})

// ---- 灵感列表键盘导航（↑↓ 选择 · Enter 星标 / 取消星标 · Esc 取消高亮）----
// Enter 绑星标而不是删除：删除必须二次确认，且误触不可恢复。
const cardsEl = ref<HTMLElement>()
useListNav(cardsEl, {
  rowSelector: '.card',
  enabled: () => !loading.value,
  onEnter: (el) => {
    const id = Number(el.getAttribute('data-row-id'))
    const row = filtered.value.find((r) => r.id === id)
    if (row) void toggleStar(row)
  },
})
</script>

<template>
  <div class="insp-page">
    <PageHeader title="灵感" desc="稍纵即逝的想法，3 秒记下来" module="inspiration" />

    <!-- 快速记录区 -->
    <div class="capture">
      <div class="capture-row">
        <NIcon :component="Bulb" :size="20" class="capture-bulb" />
        <input
          ref="inputEl"
          v-model="draft"
          class="capture-input"
          placeholder="写下灵感… 空格分隔 #标签，回车即存"
          @keydown.enter.prevent="saveDraft()"
        />
        <div class="mood-picker">
          <NTooltip v-for="m in MOODS" :key="m.key">
            <template #trigger>
              <button
                class="mood-btn"
                :class="{ on: moodDraft === m.key }"
                @click="() => { moodDraft = moodDraft === m.key ? null : m.key }"
              >
                <NIcon :component="m.icon" :size="16" />
              </button>
            </template>
            {{ m.label }}{{ moodDraft === m.key ? '（再点取消）' : '' }}
          </NTooltip>
        </div>
      </div>
      <div v-if="draft" class="capture-preview">
        <template v-if="parseInspiration(draft).content">{{ parseInspiration(draft).content }}</template>
        <NTag v-for="t in parseInspiration(draft).tags.split(',').filter(Boolean)" :key="t" size="tiny" :bordered="false" type="warning">#{{ t }}</NTag>
        <span v-if="moodDraft" class="mood-hint">{{ MOODS.find((m) => m.key === moodDraft)?.label }}</span>
      </div>
    </div>

    <!-- 工具行：搜索 + 标签过滤 -->
    <div class="tools">
      <div class="search-box">
        <NIcon :component="Search" :size="14" />
        <input v-model="keyword" class="search-input" placeholder="搜索灵感 / #标签" />
      </div>
      <div v-if="allTags.length" class="tag-cloud">
        <button
          v-for="x in allTags"
          :key="x.tag"
          class="tag-btn"
          :class="{ on: tagFilter === x.tag }"
          @click="() => { tagFilter = tagFilter === x.tag ? null : x.tag }"
        >
          #{{ x.tag }}<span class="tag-n">{{ x.count }}</span>
        </button>
      </div>
    </div>

    <!-- 列表 -->
    <ListSkeleton v-if="loading" :rows="5" />
    <div v-else-if="filtered.length" class="cards" ref="cardsEl" tabindex="0" :aria-label="'灵感列表，共 ' + filtered.length + ' 行，↑↓ 选择、Enter 切换星标'">
      <div v-for="r in filtered" :key="r.id" class="card" :class="{ starred: r.starred }" :data-row-id="r.id">
        <div class="card-main">
          <p class="card-content">{{ r.content }}</p>
          <div class="card-meta">
            <NTag v-for="t in (r.tags || '').split(',').map((x) => x.trim()).filter(Boolean)" :key="t" size="tiny" :bordered="false" type="warning">#{{ t }}</NTag>
            <span v-if="r.mood" class="card-mood">{{ MOODS.find((m) => m.key === r.mood)?.label }}</span>
            <span class="card-time">{{ fmtTime(r.createdAt) }}</span>
          </div>
        </div>
        <div class="card-ops">
          <button class="op-btn" :class="{ on: r.starred }" title="星标置顶" @click="() => toggleStar(r)">
            <NIcon :component="Star" :size="15" />
          </button>
          <button class="op-btn del" title="删除" @click="() => remove(r)">
            <NIcon :component="Trash" :size="15" />
          </button>
        </div>
      </div>
    </div>
    <EmptyState v-else-if="!loading" :text="keyword || tagFilter ? '没有符合条件的灵感' : '还没有灵感，上面写一条试试'" />
  </div>
</template>

<style scoped>
.insp-page {
  max-width: 860px;
  margin: 0 auto;
}

/* 快速记录区：大、醒目、无负担 */
.capture {
  background: var(--wb-card);
  border: var(--wb-border-w) solid var(--wb-border);
  border-radius: var(--wb-radius-lg);
  padding: 14px 16px;
  margin-bottom: 14px;
}
.capture-row {
  display: flex;
  align-items: center;
  gap: var(--wb-sp-3);
}
.capture-bulb {
  color: var(--wb-module-inspiration);
  flex: none;
}
.capture-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--wb-text-1);
  font-size: var(--wb-fs-xl);
  font-family: var(--wb-font);
  padding: 6px 0;
}
.capture-input::placeholder {
  color: var(--wb-text-3);
}
.capture-preview {
  display: flex;
  align-items: center;
  gap: var(--wb-sp-2);
  flex-wrap: wrap;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--wb-border);
  font-size: var(--wb-fs-md);
  color: var(--wb-text-2);
}
.mood-hint {
  font-size: var(--wb-fs-sm);
  color: var(--wb-text-3);
}
.mood-picker {
  display: flex;
  gap: var(--wb-sp-1);
  flex: none;
}
.mood-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--wb-radius-sm);
  border: var(--wb-border-w) solid transparent;
  background: transparent;
  color: var(--wb-text-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mood-btn:hover {
  background: var(--wb-card-alt);
  color: var(--wb-text-2);
}
.mood-btn.on {
  color: var(--wb-module-inspiration);
  border-color: var(--wb-module-inspiration);
  background: color-mix(in srgb, var(--wb-module-inspiration) 10%, transparent);
}

/* 工具行 */
.tools {
  display: flex;
  align-items: center;
  gap: var(--wb-sp-3);
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.search-box {
  display: flex;
  align-items: center;
  gap: var(--wb-sp-2);
  color: var(--wb-text-3);
  border: var(--wb-border-w) solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  background: var(--wb-card);
  padding: 5px 10px;
  min-width: 200px;
}
.search-input {
  border: none;
  outline: none;
  background: transparent;
  color: var(--wb-text-1);
  font-size: var(--wb-fs-md);
  width: 100%;
  font-family: var(--wb-font);
}
.tag-cloud {
  display: flex;
  gap: var(--wb-sp-2);
  flex-wrap: wrap;
}
.tag-btn {
  font-size: var(--wb-fs-sm);
  color: var(--wb-text-2);
  background: var(--wb-card);
  border: var(--wb-border-w) solid var(--wb-border);
  border-radius: var(--wb-radius-lg);
  padding: 2px 10px;
  cursor: pointer;
}
.tag-btn:hover {
  background: var(--wb-card-alt);
}
.tag-btn.on {
  color: var(--wb-module-inspiration);
  border-color: var(--wb-module-inspiration);
}
.tag-n {
  margin-left: 4px;
  color: var(--wb-text-3);
  font-size: var(--wb-fs-xs);
}

/* 卡片列表 */
.cards {
  display: flex;
  flex-direction: column;
  gap: var(--wb-sp-2);
}
.card {
  display: flex;
  align-items: flex-start;
  gap: var(--wb-sp-3);
  background: var(--wb-card);
  border: var(--wb-border-w) solid var(--wb-border);
  border-radius: var(--wb-radius-md);
  padding: 12px 14px;
}
.card.starred {
  border-color: color-mix(in srgb, var(--wb-module-inspiration) 55%, var(--wb-border));
  background: color-mix(in srgb, var(--wb-module-inspiration) 5%, var(--wb-card));
}
.card-main {
  flex: 1;
  min-width: 0;
}
.card-content {
  margin: 0 0 6px;
  font-size: var(--wb-fs-lg);
  color: var(--wb-text-1);
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.card-meta {
  display: flex;
  align-items: center;
  gap: var(--wb-sp-2);
  flex-wrap: wrap;
}
.card-mood {
  font-size: var(--wb-fs-xs);
  color: var(--wb-text-3);
}
.card-time {
  font-size: var(--wb-fs-xs);
  color: var(--wb-text-3);
  margin-left: auto;
}
.card-ops {
  display: flex;
  gap: var(--wb-sp-1);
  flex: none;
}
.op-btn {
  width: 26px;
  height: 26px;
  border-radius: var(--wb-radius-sm);
  border: none;
  background: transparent;
  color: var(--wb-text-3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.op-btn:hover {
  background: var(--wb-card-alt);
  color: var(--wb-text-1);
}
.op-btn.on {
  color: var(--wb-module-inspiration);
}
.op-btn.del:hover {
  color: var(--wb-danger);
}
</style>
