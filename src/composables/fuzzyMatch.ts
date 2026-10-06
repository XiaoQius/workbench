/**
 * 模糊匹配：支持多关键词（顺序无关）与中文拼音首字母。
 *
 * 背景：命令面板与各视图此前一律用 `String.includes()` 做精确子串匹配，
 * 有两个实际痛点：
 *   1. 多关键词必须按原顺序连着出现 —— 中文习惯是「笔记本 待办」这类
 *      空格分隔的散词，顺序不一致就搜不到。
 *   2. 中文只能打完整汉字 —— 想用「bjb」搜「笔记本」搜不到。
 *
 * 实现取舍：
 *   · 拼音只做**首字母**（zero-dependency）：不引入拼音词库，靠常见
 *     汉字首字母表覆盖高频字。命中不了时自动退化为子串匹配，不会漏。
 *   · 返回评分用于结果排序，让「更匹配」的排前面而不是只返回布尔。
 */

/**
 * 常见汉字 → 拼音首字母表。
 * 每项是长度 2 的字符串：[0] 汉字，[1] 首字母。
 * 刻意用数组而非对象字面量：界面里同音/多音字多，对象写法重复键会 TS1117。
 * 覆盖范围是本项目界面出现频率高的字；命中不了时会自动退化为子串匹配，不会漏。
 */
const PINYIN_TABLE: string[] = [
  // 模块与页面
  '总z', '览l', '概g', '工g', '作z', '台t', '开k', '发f', '运y', '维w',
  '生s', '活h', '学x', '习x', '知z', '识s', '库k', '灵l', '感g', '面m',
  // 业务对象
  '项x', '目m', '任r', '务w', '代d', '码m', '片p', '段d', '服f', '器q',
  '域y', '名m', '笔b', '记j', '账z', '收s', '支z', '惯g', '课k', '程c',
  '业y', '绩j', '番f', '茄q', '倒d', '计j', '时s', '备b', '份f', '恢h',
  '复f', '设s', '置z', '主z', '题t', '服f', '务w', '端d', '版b', '本b',
  // 操作与状态
  '新x', '建j', '编b', '辑j', '删s', '除c', '查c', '看k', '打d', '关g',
  '导d', '出c', '清q', '空k', '重z', '更g', '同t', '步b', '搜s', '索s',
  '完w', '进j', '行x', '中z', '已y', '未w', '全q', '部b', '单d', '待d',
  '办b', '标b', '状z', '态t', '日r', '周z', '月y', '年n', '天t', '分f',
  '念n', '历l', '史s', '档d', '案a', '借j', '疫y', '苗m', '体t', '检j',
  '流l', '水s', '统t', '计j', '图t', '表b', '报b', '警j', '磁c', '盘p',
  '监k', '控k', '随s', '身s', '切q', '换h', '启q', '停t', '刷s', '试s',
]

const PINYIN_FIRST: Map<string, string> = new Map(
  PINYIN_TABLE.map((pair) => [pair[0], pair[1]] as [string, string]),
)

function pinyinFirstLetter(ch: string): string {
  return PINYIN_FIRST.get(ch) ?? ''
}

/** 取一个词的「匹配源」：原文 + 拼音首字母串 */
function matchSource(text: string): string {
  let py = ''
  for (const ch of text) {
    py += pinyinFirstLetter(ch)
  }
  return `${text.toLowerCase()} ${py}`
}

const srcCache = new Map<string, string>()
function cachedSource(key: string, fields: string[]): string {
  const cachedKey = fields.join('\u0000')
  const hit = srcCache.get(cachedKey)
  if (hit !== undefined) return hit
  const built = fields.map(matchSource).join(' ')
  // 命令面板每次输入都会对全量候选重算，缓存上限防止 Map 无限增长
  if (srcCache.size > 3000) srcCache.clear()
  srcCache.set(cachedKey, built)
  return built
}

/**
 * 模糊匹配。返回评分（0 = 不匹配，越大越匹配），用于排序。
 *
 * @param query   用户输入，支持空格分隔多关键词
 * @param fields  待匹配的多个字段（label / hint / group 等），任一字段命中即算
 */
export function fuzzyScore(query: string, fields: (string | undefined)[]): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const terms = q.split(/\s+/).filter(Boolean)
  if (!terms.length) return 1

  // 用 '\u0000' 拼接避免字段边界粘连产生假命中
  const source = cachedSource(q, fields.map((f) => f || ''))

  let score = 0
  for (const term of terms) {
    const idx = source.indexOf(term)
    if (idx === -1) return 0 // 多关键词是 AND：任一词不匹配就整体排除
    // 越靠前得分越高；整词出现在原文（非拼音部分）额外加分
    score += Math.max(1, 10 - idx / 20)
    const inRaw = fields.some((f) => (f || '').toLowerCase().includes(term))
    if (inRaw) score += 5
  }
  return score
}

/** 简版布尔匹配，用于只关心是否命中的场景 */
export function fuzzyHit(query: string, fields: (string | undefined)[]): boolean {
  return fuzzyScore(query, fields) > 0
}
