
export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export type ProviderMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string }

export interface ChatOptions {
  signal: AbortSignal
  onToken: (text: string) => void
  tools?: ToolDefinition[]
}

export interface ChatResult {
  toolCalls: ToolCall[]
}

export interface AIProvider {
  readonly id: string
  readonly label: string
  chat(messages: ProviderMessage[], options: ChatOptions): Promise<ChatResult>
  listModels(): Promise<string[]>
}

export type ProviderErrorKind =
  | 'missing_key'
  | 'invalid_key'
  | 'rate_limit'
  | 'too_large'
  | 'network'
  | 'timeout'
  | 'server'
  | 'bad_request'
  | 'cancelled'
  | 'empty'
  | 'unknown'

export class ProviderError extends Error {
  kind: ProviderErrorKind
  retryAfterSec?: number

  constructor(kind: ProviderErrorKind, message: string, retryAfterSec?: number) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
    this.retryAfterSec = retryAfterSec
  }
}

export function userMessage(err: ProviderError): string {
  switch (err.kind) {
    case 'missing_key':
      return 'Falta a chave de API da Groq. Abra as configurações para adicioná-la (o plano gratuito basta).'
    case 'invalid_key':
      return 'A Groq recusou a chave de API. Confira se ela foi copiada inteira ou crie uma nova.'
    case 'rate_limit':
      return err.retryAfterSec
        ? `Limite de uso do plano gratuito atingido. Tente novamente em cerca de ${err.retryAfterSec} s.`
        : 'Limite de uso do plano gratuito atingido (há limites por minuto e por dia). Tente novamente em instantes.'
    case 'too_large':
      return 'A conversa ficou grande demais para o limite do plano gratuito. Comece uma nova conversa ou envie uma mensagem menor.'
    case 'network':
      return 'Não consegui falar com a Groq. Verifique sua conexão com a internet.'
    case 'timeout':
      return 'A Groq demorou demais para responder. Tente novamente.'
    case 'server':
      return `A Groq está com instabilidade (${err.message}). Tente novamente em instantes.`
    case 'bad_request':
      return `A Groq recusou o pedido: ${err.message}`
    case 'empty':
      return 'O modelo não devolveu nenhum texto. Tente reformular a mensagem.'
    case 'cancelled':
      return 'Resposta cancelada.'
    default:
      return `Erro inesperado: ${err.message}`
  }
}
