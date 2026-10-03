/**
 * profileSync —— 头像跨设备同步（profile 业务表 ↔ localStorage 设置缓存）
 *
 * 数据流：
 *   本机改头像：settings(reactive) → 防抖 upsert profile 行 → 触发器记账 → 立即 syncNow 推送
 *   远端改头像：syncNow 拉取（busy=1 期间触发器不记账）→ 同步完成事件 → 读回 profile 行写回 settings
 *
 * localStorage(KEY='wb_settings_v1') 仍是本地缓存与唯一渲染源，useSettings 签名不变；
 * profile 表只是它在云端的样子。
 *
 * 防乒乓（远端写回本地 → watcher 又写库 → 触发器推回远端）共四层，任一层都能单独拦住回声：
 *   1) 现有 _sync_flag.busy 护栏：拉取落库期间触发器不记账，远端行本身不会产生 pending；
 *   2) _ut 基线：每次本地写库后回读 _sync_state.ut 记为 lastAppliedUt，
 *      只有远端版本严格更新才写回，自己刚写的行不会“写回自己”；
 *   3) 内容比对：写回前远端内容与 settings 相同则直接跳过，不产生 reactive 改动；
 *   4) 回声快照：写回时登记 remoteSnapshot，watcher 发现本轮改动与它一致则吞掉（不写库）。
 * 另：本机有未落库的编辑（localDirty）时暂缓写回，让本地编辑按 LWW 正常上云，
 * 避免启动窗口内「刚改完头像就被旧远端值覆盖」。
 */
import { watch } from 'vue'
import { exec, query } from '@/db/client'
import { onSyncStatus, syncNow } from '@/db/sync'
import { useSettings } from './useSettings'

interface ProfileView {
  id: number
  avatarText: string | null
  avatarColor: string | null
  avatarImg: string | null
  ut: number | null
}

type ProfileContent = { avatarText: string; avatarColor: string; avatarImg: string }

const DEBOUNCE_MS = 600

let initialized = false
let writeTimer: number | undefined
/** 队列里有本机编辑尚未落库（LWW 让本地优先，暂缓远端写回） */
let localDirty = false
/** 最近一次已应用的 _sync_state.ut：小于等于它的库内行都是「我已经见过的」，不再写回 */
let lastAppliedUt = 0
/** 远端写回时登记的内容快照：watcher 命中它说明这次改动来自远端，吞掉不回推 */
let remoteSnapshot: ProfileContent | null = null

function localContent(): ProfileContent {
  const s = useSettings()
  return { avatarText: s.avatarText ?? '', avatarColor: s.avatarColor ?? '', avatarImg: s.avatarImg ?? '' }
}

function sameContent(a: ProfileContent, b: ProfileContent): boolean {
  return a.avatarText === b.avatarText && a.avatarColor === b.avatarColor && a.avatarImg === b.avatarImg
}

/** 读当前设备的 profile 行及其记账版本（异常多行时取版本最新的一行） */
async function readProfileRow(): Promise<ProfileView | null> {
  const rows = await query<ProfileView>(
    `SELECT p.id AS id, p.avatarText AS avatarText, p.avatarColor AS avatarColor, p.avatarImg AS avatarImg,
            s.ut AS ut
     FROM profile p
     LEFT JOIN _sync_state s ON s.tableName = 'profile' AND s.rowId = p.id
     ORDER BY COALESCE(s.ut, 0) DESC, p.id DESC
     LIMIT 1`,
  )
  return rows[0] ?? null
}

/**
 * settings → profile 表（单行语义）。
 * 不强行固定主键写 id=1：拉取落地的行主键是服务端分配的 id，本机写回只会改那一行。
 * 若另外插一条 id=1，本机就会出现两条各自映射不同 serverId 的“头像行”，
 * 云端从此存在两份 profile 记录，乒乓不可收拾。
 */
async function writeProfile(): Promise<void> {
  localDirty = false
  const cur = localContent()
  const row = await readProfileRow()
  if (row) {
    const stored: ProfileContent = {
      avatarText: row.avatarText ?? '',
      avatarColor: row.avatarColor ?? '',
      avatarImg: row.avatarImg ?? '',
    }
    // 护栏 3：内容没变就不写，避免触发器空记账
    if (sameContent(stored, cur)) return
    await exec(
      `UPDATE profile SET avatarText = ?, avatarColor = ?, avatarImg = ?, updatedAt = ? WHERE id = ?`,
      [cur.avatarText, cur.avatarColor, cur.avatarImg, Date.now(), row.id],
    )
  } else {
    // 本机从没设置过头像 → 不建空行，省掉一次无意义的全库首推
    if (!cur.avatarText && !cur.avatarColor && !cur.avatarImg) return
    await exec(
      `INSERT INTO profile (avatarText, avatarColor, avatarImg, updatedAt) VALUES (?, ?, ?, ?)`,
      [cur.avatarText, cur.avatarColor, cur.avatarImg, Date.now()],
    )
  }
  // 护栏 2：回读触发器写的 ut 作为基线（ut 是 SQL 侧时间，比本地 JS 时钟可靠）
  const after = await readProfileRow()
  if (after?.ut != null) lastAppliedUt = after.ut
  // 头像属于「改了就该立刻看见」的数据：云开启时马上推一次，不等 WS/轮询
  if (useSettings().cloudEnabled) void syncNow().catch(() => { /* 失败状态由同步引擎统一呈现 */ })
}

function scheduleWrite(): void {
  localDirty = true
  if (writeTimer !== undefined) window.clearTimeout(writeTimer)
  writeTimer = window.setTimeout(() => {
    writeTimer = undefined
    writeProfile().catch(() => {
      localDirty = false
      /* 非 Tauri 环境（浏览器演示降级）无 SQLite，静默跳过 */
    })
  }, DEBOUNCE_MS)
}

/**
 * profile 表 → settings（云同步拉取完成后调用）。
 * 只在「版本更新 且 内容不同」时写回，写回前登记快照，让 watcher 认出这是远端回声。
 */
export async function reloadProfile(): Promise<void> {
  // 本机有未落库的编辑：先让本地值推上云，远端值随后会作为新版本回来
  if (localDirty) return
  let row: ProfileView | null
  try {
    row = await readProfileRow()
  } catch {
    return // 库不可用（演示降级）
  }
  if (!row) return
  const ut = row.ut ?? 0
  if (ut <= lastAppliedUt) return // 本机没落后于远端（含自己刚写的回声）
  lastAppliedUt = ut
  const remote: ProfileContent = {
    avatarText: row.avatarText ?? '',
    avatarColor: row.avatarColor ?? '',
    avatarImg: row.avatarImg ?? '',
  }
  if (sameContent(remote, localContent())) return
  const s = useSettings()
  remoteSnapshot = remote
  s.avatarText = remote.avatarText
  s.avatarColor = remote.avatarColor
  s.avatarImg = remote.avatarImg
}

/**
 * App 启动（initDb 建表完成、initSync 就绪）后调用一次；重复调用只生效一次。
 */
export function initProfileSync(): void {
  if (initialized) return
  initialized = true
  const s = useSettings()

  watch(
    () => [s.avatarText, s.avatarColor, s.avatarImg] as const,
    () => {
      if (remoteSnapshot) {
        const echo = sameContent(localContent(), remoteSnapshot)
        remoteSnapshot = null // 快照一次性的：用户随后又改过就按本地改动处理
        if (echo) return // 远端写回的回声：不回库、不回推
      }
      scheduleWrite()
    },
    { flush: 'post' },
  )

  // 借现成的同步状态事件做「拉取完成」钩子，不改 sync.ts 主循环。
  // 只在成功态翻转时读回，lastSyncAt 去重防止同一次完成重复应用。
  // 注意：这里不做启动即读回 —— 首轮 syncNow 完成自然会触发本钩子。
  // 启动时直接读库有反噬风险：上次会话若在防抖窗口内崩溃，库里是旧值、
  // localStorage 是新值，先读回会把用户的新编辑覆盖掉。
  let lastHookedAt: number | null = null
  onSyncStatus((st) => {
    if (st.state !== 'idle' || st.lastSyncAt == null) return
    if (st.lastSyncAt === lastHookedAt) return
    lastHookedAt = st.lastSyncAt
    void reloadProfile()
  })
}
