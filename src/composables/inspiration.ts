// 灵感输入解析：「做个自动剪辑工具 #工具 #视频」→ { content, tags }
// 供 InspirationView 与顶栏快速捕获复用，保证两处行为一致。
export function parseInspiration(raw: string): { content: string; tags: string } {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  const words: string[] = []
  const tags: string[] = []
  for (const t of tokens) {
    if (t.startsWith('#') && t.length > 1) tags.push(t.slice(1))
    else words.push(t)
  }
  return { content: words.join(' '), tags: tags.join(',') }
}
