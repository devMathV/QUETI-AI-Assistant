import { createGuard, fetchChecked, mapAbortOrNetwork, type Guard } from './http'
import {
  ProviderError,
  type AIProvider,
  type ChatOptions,
  type ChatResult,
  type ProviderMessage,
  type ToolCall
} from './types'

const FIRST_BYTE_TIMEOUT_MS = 30_000
const STALL_TIMEOUT_MS = 30_000
const LIST_TIMEOUT_MS = 15_000

export interface OpenAICompatConfig {
  id: string
  label: string
  baseUrl: string
  apiKey: string | null
  model: string
  maxTokens: number
}

interface PartialCall {
  id: string
  name: string
  args: string
}

function toWire(m: ProviderMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } }))
    }
  }
  return { role: m.role, content: m.content }
}

export class OpenAICompatProvider implements AIProvider {
  readonly id: string
  readonly label: string
  private cfg: OpenAICompatConfig

  constructor(cfg: OpenAICompatConfig) {
    this.cfg = cfg
    this.id = cfg.id
    this.label = cfg.label
  }

  private key(): string {
    if (!this.cfg.apiKey) throw new ProviderError('missing_key', 'chave ausente')
    return this.cfg.apiKey
  }

  async chat(messages: ProviderMessage[], options: ChatOptions): Promise<ChatResult> {
    const key = this.key()
    const guard = createGuard(options.signal, FIRST_BYTE_TIMEOUT_MS)
    try {
      const body: Record<string, unknown> = {
        model: this.cfg.model,
        messages: messages.map(toWire),
        stream: true,
        max_tokens: this.cfg.maxTokens
      }
      if (options.tools && options.tools.length > 0) {
        body.tools = options.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }))
        body.tool_choice = 'auto'
      }
      const res = await fetchChecked(
        `${this.cfg.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(body)
        },
        guard
      )
      if (!res.body) throw new ProviderError('empty', 'sem corpo')
      guard.reset(STALL_TIMEOUT_MS)
      const calls = new Map<number, PartialCall>()
      await this.readStream(res.body, guard, options.onToken, calls)
      const toolCalls: ToolCall[] = [...calls.entries()]
        .sort((a, b) => a[0] - b[0])
        .filter(([, c]) => c.name)
        .map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, arguments: c.args || '{}' }))
      return { toolCalls }
    } finally {
      guard.dispose()
    }
  }

  private async readStream(
    body: ReadableStream<Uint8Array>,
    guard: Guard,
    onToken: (t: string) => void,
    calls: Map<number, PartialCall>
  ): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>
        try {
          chunk = await reader.read()
        } catch (error) {
          throw mapAbortOrNetwork(error, guard)
        }
        if (chunk.done) return
        guard.reset(STALL_TIMEOUT_MS)
        buffer += decoder.decode(chunk.value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '[DONE]') return
          this.handleEvent(data, onToken, calls)
        }
      }
    } finally {
      reader.cancel().catch(() => {})
    }
  }

  private handleEvent(data: string, onToken: (t: string) => void, calls: Map<number, PartialCall>): void {
    let json: {
      error?: { message?: unknown }
      choices?: {
        delta?: {
          content?: unknown
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
        }
      }[]
    }
    try {
      json = JSON.parse(data)
    } catch {
      return
    }
    if (json.error) {
      const message = typeof json.error.message === 'string' ? json.error.message.slice(0, 300) : 'erro no streaming'
      throw new ProviderError('bad_request', message)
    }
    const delta = json.choices?.[0]?.delta
    if (typeof delta?.content === 'string' && delta.content.length > 0) onToken(delta.content)
    for (const tc of delta?.tool_calls ?? []) {
      const index = typeof tc.index === 'number' ? tc.index : 0
      const entry = calls.get(index) ?? { id: '', name: '', args: '' }
      if (tc.id) entry.id = tc.id
      if (tc.function?.name) entry.name = tc.function.name
      if (typeof tc.function?.arguments === 'string') entry.args += tc.function.arguments
      calls.set(index, entry)
    }
  }

  async listModels(): Promise<string[]> {
    const key = this.key()
    const guard = createGuard(undefined, LIST_TIMEOUT_MS)
    try {
      const res = await fetchChecked(`${this.cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${key}` } }, guard)
      const json = (await res.json()) as { data?: { id?: unknown }[] }
      return (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string').sort()
    } finally {
      guard.dispose()
    }
  }
}
