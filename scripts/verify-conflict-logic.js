// 冲突判定矩阵验证：把 sync.ts 里的判定条件抽出来跑四种场景
// 判定式：stale 且 ut > baseUt 且 del === 0 → conflict，否则 stale（以云端为准）
function classify(entry) {
  if (entry.ut > entry.baseUt && entry.del === 0) return 'conflict'
  return 'stale'
}

const cases = [
  {
    name: '本地干净，云端被别人改了 → 应以云端为准（不打扰用户）',
    entry: { ut: 1000, baseUt: 1000, del: 0 },
    expect: 'stale',
  },
  {
    name: '离线时改了本地，云端也被改 → 真冲突，保留双方',
    entry: { ut: 2000, baseUt: 1000, del: 0 },
    expect: 'conflict',
  },
  {
    name: '离线时新建的行（从未与云端对齐）→ 必须判冲突，不能被吃掉',
    entry: { ut: 3000, baseUt: 0, del: 0 },
    expect: 'conflict',
  },
  {
    name: '本地删除被拒 → 无法裁决，以云端为准',
    entry: { ut: 2000, baseUt: 1000, del: 1 },
    expect: 'stale',
  },
]

let fail = 0
for (const c of cases) {
  const got = classify(c.entry)
  const ok = got === c.expect
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}\n      期望=${c.expect} 实际=${got}`)
}
console.log(`\n${cases.length - fail}/${cases.length} 通过`)
process.exit(fail === 0 ? 0 : 1)
