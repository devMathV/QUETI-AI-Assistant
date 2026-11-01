import { createGuard, fetchChecked, mapAbortOrNetwork, type Guard } from './http'
import { ProviderError, type AIProvider, type ChatOptions, type ProviderMessage } from './types'

// Adaptador para qualquer API no formato "OpenAI-compatível" (Groq, OpenRouter, Ollama...).
// Lê o streaming SSE à mão: assim não precisamos de nenhuma biblioteca extra.

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

  async chat(messages: ProviderMessage[], options: ChatOptions): Promise<void> {
    const key = this.key()
    const guard = createGuard(options.signal, FIRST_BYTE_TIMEOUT_MS)
    try {
      const res = await fetchChecked(
        `${this.cfg.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: this.cfg.model,
            messages,
            stream: true,
            max_tokens: this.cfg.maxTokens
          })
        },
        guard
      )
      if (!res.body) throw new ProviderError('empty', 'sem corpo')
      guard.reset(STALL_TIMEOUT_MS)
      await this.readStream(res.body, guard, options.onToken)
    } finally {
      guard.dispose()
    }
  }

  private async readStream(body: ReadableStream<Uint8Array>, guard: Guard, onToken: (t: string) => void): Promise<void> {
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
          this.handleEvent(data, onToken)
        }
      }
    } finally {
      reader.cancel().catch(() => {})
    }
  }

  private handleEvent(data: string, onToken: (t: string) => void): void {
    let json: { error?: { message?: unknown }; choices?: { delta?: { content?: unknown } }[] }
    try {
      json = JSON.parse(data)
    } catch {
      return // linha incompleta ou irrelevante
    }
    if (json.error) {
      const message = typeof json.error.message === 'string' ? json.error.message.slice(0, 300) : 'erro no streaming'
      throw new ProviderError('bad_request', message)
    }
    const delta = json.choices?.[0]?.delta?.content
    if (typeof delta === 'string' && delta.length > 0) onToken(delta)
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
