// LLM 客户端（工作台升级：设置 → AI 与 LLM 自定义服务配置）
// 支持 OpenAI 兼容协议（OpenAI / DeepSeek / 阿里百炼 / 任意 custom 端点）与 Ollama 本地服务。
import { useSettings } from './useSettings'

/** 是否已配置可用的 LLM 服务（apiKey 或 baseUrl 任一非空即视为已配置） */
export function llmConfigured(): boolean {
  const s = useSettings()
  return !!(s.llm.apiKey.trim() || s.llm.baseUrl.trim())
}

/** 返回已配置服务的展示文案 */
export function llmConfigLabel(): string {
  const s = useSettings()
  const prov = s.llm.provider || 'custom'
  const model = s.llm.model.trim()
  return `${prov}${model ? ` / ${model}` : ''}`
}

/** 调用已配置的 LLM 服务（OpenAI 兼容 chat/completions） */
export async function llmChat(system: string, user: string): Promise<string> {
  const s = useSettings()
  if (!llmConfigured()) throw new Error('未配置 LLM 服务，请先在 设置 → AI 与 LLM 中填写服务地址与密钥')
  const cfg = s.llm
  const apiKey = cfg.apiKey.trim()
  let base = cfg.baseUrl.trim().replace(/\/+$/, '')
  if (!base) {
    // 未填 baseUrl 时按 provider 提供默认端点
    if (cfg.provider === 'deepseek') base = 'https://api.deepseek.com/v1'
    else if (cfg.provider === 'ollama') base = 'http://localhost:11434/v1'
    else if (cfg.provider === 'anthropic') base = 'https://api.anthropic.com/v1'
    else base = 'https://api.openai.com/v1'
  }
  const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
  const model = cfg.model.trim() || (cfg.provider === 'ollama' ? 'llama3' : 'gpt-4o-mini')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`LLM 请求失败（HTTP ${res.status}）：${body.slice(0, 200)}`)
  }
  const data = await res.json()
  const content: string | undefined = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM 响应中未找到内容字段')
  return content
}
