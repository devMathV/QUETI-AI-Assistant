import { net } from 'electron'
import { ProviderError } from './types'

// Utilitários compartilhados pelos adaptadores que falam com serviços na internet
// (chat e transcrição de voz): tempo limite, cancelamento e tradução de erros HTTP.

/** Junta cancelamento do usuário + tempo limite em um único AbortSignal. */
export interface Guard {
  signal: AbortSignal
  timedOut: () => boolean
  cancelled: () => boolean
  reset: (ms: number) => void
  dispose: () => void
}

export function createGuard(parent: AbortSignal | undefined, ms: number): Guard {
  const ctl = new AbortController()
  let timedOut = false
  let timer: NodeJS.Timeout | undefined
  const onParentAbort = (): void => ctl.abort()
  const arm = (delay: number): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      ctl.abort()
    }, delay)
  }
  if (parent?.aborted) ctl.abort()
  else parent?.addEventListener('abort', onParentAbort, { once: true })
  arm(ms)
  return {
    signal: ctl.signal,
    timedOut: () => timedOut,
    cancelled: () => !!parent?.aborted,
    reset: arm,
    dispose: () => {
      if (timer) clearTimeout(timer)
      parent?.removeEventListener('abort', onParentAbort)
    }
  }
}

export function mapAbortOrNetwork(error: unknown, guard: Guard): ProviderError {
  if (error instanceof ProviderError) return error
  if (guard.timedOut()) return new ProviderError('timeout', 'tempo esgotado')
  if (guard.cancelled()) return new ProviderError('cancelled', 'cancelado')
  return new ProviderError('network', error instanceof Error ? error.message : String(error))
}

export async function httpError(res: Response): Promise<ProviderError> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: unknown } }
    if (typeof body?.error?.message === 'string') detail = body.error.message.slice(0, 300)
  } catch {
    // corpo sem JSON: seguimos só com o código HTTP
  }
  const retry = Number(res.headers.get('retry-after'))
  const retryAfterSec = Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : undefined
  const s = res.status
  if (s === 401 || s === 403) return new ProviderError('invalid_key', detail || `HTTP ${s}`)
  if (s === 429) return new ProviderError('rate_limit', detail || 'HTTP 429', retryAfterSec)
  if (s === 413) return new ProviderError('too_large', detail || 'HTTP 413')
  if (s >= 500) return new ProviderError('server', `erro ${s}`)
  if (s >= 400) return new ProviderError('bad_request', detail || `HTTP ${s}`)
  return new ProviderError('unknown', `HTTP ${s}`)
}

/** net.fetch (respeita o proxy do Windows) com tradução de falhas em ProviderError. */
export async function fetchChecked(url: string, init: RequestInit, guard: Guard): Promise<Response> {
  let res: Response
  try {
    res = await net.fetch(url, { ...init, signal: guard.signal })
  } catch (error) {
    throw mapAbortOrNetwork(error, guard)
  }
  if (!res.ok) throw await httpError(res)
  return res
}
