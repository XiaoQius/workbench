/**
 * 版本号四处统一 bump + 自校验。
 *
 * 为什么要有这个脚本（2026-10-05 真实事故）：
 * 用 PowerShell 逐个 -replace 改版本号时，有一行 `cd` 没生效，
 * 相对路径 'package.json' 指到了**上层目录**，把 E:\workbench-suite\package.json
 * 写成了 0 字节，导致 vite 构建直接失败。上层目录没有 git，无法从历史恢复。
 *
 * 因此这里做三件事：
 *  1. 路径一律用绝对路径（相对本脚本位置推导，不受 cwd 影响）
 *  2. 每处替换后校验命中，没命中就报 NO-CHANGE（避免「执行成功但没改」）
 *  3. 改完全量回读四处比对，不一致就非零退出
 *
 * 用法：node scripts/bump-version.mjs 0.3.3 0.3.4
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// 绝对路径推导：不受调用方 cwd 影响
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const FROM = process.argv[2]
const TO = process.argv[3]
if (!FROM || !TO || !/^\d+\.\d+\.\d+$/.test(FROM) || !/^\d+\.\d+\.\d+$/.test(TO)) {
  console.error('用法: node scripts/bump-version.mjs <当前版本> <目标版本>   例: 0.3.3 0.3.4')
  process.exit(1)
}

const esc = (s) => s.replace(/\./g, '\\.')
const FILES = [
  ['package.json', new RegExp(`"version": "${esc(FROM)}"`), `"version": "${TO}"`],
  // Cargo.toml 的 version 在行首，必须带 m 标志，否则行首锚点不匹配（曾静默漏改）
  ['src-tauri/Cargo.toml', new RegExp(`^version = "${esc(FROM)}"`, 'm'), `version = "${TO}"`],
  ['src-tauri/tauri.conf.json', new RegExp(`"version": "${esc(FROM)}"`), `"version": "${TO}"`],
  ['src/composables/useSettings.ts', new RegExp(`APP_VERSION = '${esc(FROM)}'`), `APP_VERSION = '${TO}'`],
]

let missed = 0
for (const [file, from, to] of FILES) {
  const abs = join(ROOT, file)
  const before = readFileSync(abs, 'utf8')
  const after = before.replace(from, to)
  if (after === before) {
    missed++
    console.log(`FAIL 未命中: ${file}（正则 ${from} 没匹配到，检查版本号是否已是 ${TO} 或格式变了）`)
  } else {
    writeFileSync(abs, after, 'utf8')
    console.log(`ok   已更新: ${file}`)
  }
}

console.log('--- 回读校验 ---')
const CHECKS = [
  ['package.json', /"version": "([^"]+)"/],
  ['src-tauri/Cargo.toml', /^version = "([^"]+)"/m],
  ['src-tauri/tauri.conf.json', /"version": "([^"]+)"/],
  ['src/composables/useSettings.ts', /APP_VERSION = '([^']+)'/],
]
let bad = 0
for (const [file, re] of CHECKS) {
  const m = readFileSync(join(ROOT, file), 'utf8').match(re)
  const v = m ? m[1] : '未找到'
  if (v !== TO) bad++
  console.log(`${v === TO ? 'ok  ' : 'FAIL'} ${file} -> ${v}`)
}

if (missed || bad) {
  console.log(`\n版本号更新失败：未命中 ${missed} 处、不一致 ${bad} 处`)
  process.exit(1)
}
console.log(`\n四处版本号已统一为 ${TO}`)
