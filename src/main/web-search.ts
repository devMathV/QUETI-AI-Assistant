import { createGuard, fetchChecked } from './providers/http'
import { ProviderError } from './providers/types'
import { deleteSecret, getSecret, hasSecret, secretsAvailable, setSecret } from './secrets'
import { getSettings, updateSettings } from './settings'
import { broadcast } from './windows'
import type { SearchConfig } from '../shared/types'

// Pesquisa na web via Tavily (plano gratuito: 1.000 créditos/mês, sem cartão; 1 busca básica = 1 crédito).
// A URL é fixa no código; a chave é do usuário e fica criptografada.

export const TAVILY_SECRET = 'tavily-api-key'
export const TAVILY_KEY_PATTERN = /^tvly-[A-Za-z0-9_-]{10,200}$/
const ENDPOINT = 'https://api.tavily.com/search'
const MAX_RESULTS = 5
const SNIPPET_CHARS = 600
const TIMEOUT_MS = 20_000
const MONTHLY_FREE = 1000

export interface WebResult {
  title: string
  url: string
  content: string
}

const monthKey = (): string => new Date().toISOString().slice(0, 7)

function usedThisMonth(): number {
  const u = getSettings().searchUsage
  return u.month === monthKey() ? u.count : 0
}

export function searchConfig(): SearchConfig {
  return { hasKey: hasSecret(TAVILY_SECRET), secureStorage: secretsAvailable(), usedThisMonth: usedThisMonth(), monthlyFree: MONTHLY_FREE }
}

export function notifySearchConfig(): SearchConfig {
  const config = searchConfig()
  broadcast('search:configChanged', config)
  return config
}

export function saveSearchKey(key: string): void {
  setSecret(TAVILY_SECRET, key)
}

export function removeSearchKey(): void {
  deleteSecret(TAVILY_SECRET)
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

export async function searchWeb(query: string, signal: AbortSignal): Promise<WebResult[]> {
  const key = getSecret(TAVILY_SECRET)
  if (!key) throw new ProviderError('missing_key', 'chave do Tavily ausente')
  const guard = createGuard(signal, TIMEOUT_MS)
  try {
    const res = await fetchChecked(
      ENDPOINT,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ query: query.slice(0, 400), search_depth: 'basic', max_results: MAX_RESULTS })
      },
      guard
    )
    const json = (await res.json()) as { results?: { title?: unknown; url?: unknown; content?: unknown }[] }
    updateSettings({ searchUsage: { month: monthKey(), count: usedThisMonth() + 1 } }) // 1 crédito por busca básica
    notifySearchConfig()
    return (json.results ?? []).flatMap((r) => {
      const url = text(r.url)
      if (!/^https?:\/\//.test(url)) return []
      let host = url
      try {
        host = new URL(url).hostname
      } catch {
        // mantém a URL como título
      }
      return [{ title: text(r.title).trim() || host, url, content: text(r.content).slice(0, SNIPPET_CHARS) }]
    })
  } finally {
    guard.dispose()
  }
}

export function describeSearchError(error: unknown): string {
  const err = error instanceof ProviderError ? error : new ProviderError('unknown', error instanceof Error ? error.message : String(error))
  const limit = 'Limite de uso do Tavily atingido (o plano gratuito tem 1.000 créditos por mês e um limite por minuto). Tente mais tarde.'
  switch (err.kind) {
    case 'missing_key':
      return 'Falta a chave de API do Tavily para pesquisar na web. Adicione-a nas configurações (o plano gratuito basta).'
    case 'invalid_key':
      return 'O Tavily recusou a chave de API. Confira se ela foi copiada inteira ou crie uma nova.'
    case 'rate_limit':
      return limit
    case 'network':
      return 'Não consegui acessar o serviço de pesquisa. Verifique sua conexão.'
    case 'timeout':
      return 'A pesquisa demorou demais. Tente novamente.'
    case 'server':
      return 'O serviço de pesquisa está instável. Tente novamente em instantes.'
    default:
      return /limit|exceed/i.test(err.message) ? limit : `A pesquisa falhou: ${err.message}`
  }
}
