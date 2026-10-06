/**
 * 视图列表过滤的统一入口。
 *
 * 背景：Dev/Life/Ops/Study 四个视图各自定义了一份 `matchKw()`，
 * 实现都是 `includes()`，共 32 处调用 —— 同一个能力四份拷贝，
 * 且都只能精确子串匹配。
 *
 * 这里收口为单一实现并升级为模糊匹配（多关键词 + 拼音首字母），
 * 与命令面板共用 fuzzyMatch。各视图改为：
 *   import { matchKw } from '@/composables/match'
 * 删掉自己那份本地定义。
 */
import { fuzzyHit } from './fuzzyMatch'

/**
 * 关键词匹配：任一字段命中即算命中。
 * 支持空格分隔的多关键词（顺序无关）与中文拼音首字母。
 * @param kw   用户输入；空串视为全部命中
 * @param vals 待匹配的字段们
 */
export function matchKw(kw: string, ...vals: unknown[]): boolean {
  const k = kw.trim()
  if (!k) return true
  return fuzzyHit(k, vals.map((v) => (v == null ? '' : String(v))))
}
