/**
 * fuzzyMatch 正确性验证。
 * 重点防两类回归：① 拼音首字母搜不到（这是本次升级的目的）
 *               ② 反过来把原本能搜到的东西弄丢了（退化误伤）
 */
import { fuzzyHit, fuzzyScore } from '../src/composables/fuzzyMatch.ts'

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { console.log('  \u2714 ' + name); pass++ }
  else { console.log('  \u2718 ' + name + (extra ? ' -> ' + extra : '')); fail++ }
}

console.log('\n[1] 精确子串仍然命中（不退化）')
check('中文子串', fuzzyHit('新建任务', ['新建任务']))
check('英文子串', fuzzyHit('task', ['Create task']))
check('大小写不敏感', fuzzyHit('TASK', ['create task']))
check('空串总是命中', fuzzyHit('', ['任意内容']))

console.log('\n[2] 多关键词：空格分隔、顺序无关')
check('顺序一致', fuzzyHit('笔记 待办', ['待办 笔记 topic']))
check('顺序颠倒', fuzzyHit('待办 笔记', ['笔记类 待办项']))
check('缺一词则不命中', !fuzzyHit('笔记 不存在xyz', ['笔记']))

console.log('\n[3] 拼音首字母（本次升级核心）')
check('bjk -> 笔记库', fuzzyHit('bjk', ['笔记库']), 'v=' + fuzzyScore('bjk', ['笔记库']))
check('gn -> 概念', fuzzyHit('gn', ['概念']))
check('rw -> 任务', fuzzyHit('rw', ['任务']))
check('xm -> 项目', fuzzyHit('xm', ['项目']))
check('多字段任一命中', fuzzyHit('bjk', ['标签', '笔记库相关']))

console.log('\n[4] 排序：更匹配的应该排前面')
const a = fuzzyScore('新建', ['新建任务'])
const b = fuzzyScore('新建', ['任务 · 新建入口在别处'])
check('靠前出现得分更高', a > b, `a=${a} b=${b}`)

console.log('\n[5] 边界')
check('只有空格视为空', fuzzyHit('   ', ['任意']))
check('特殊正则字符不炸', fuzzyHit('.*', ['a.*b']))
check('undefined 字段不炸', fuzzyHit('test', [undefined, 'test']))

console.log(`\n\u2714 通过 ${pass} / \u2718 失败 ${fail}\n`)
process.exit(fail ? 1 : 0)
