import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { getSecret, setSecret, deleteSecret } from './secrets'
import { getSettings } from './settings'

const SECRET = 'browser-bridge-token'
const PORTS = [47831, 47832, 47833, 47834, 47835]
const MAX_BODY = 400_000
const MAX_WAIT = 25_000
const ACTION_TIMEOUT = 12_000
const TOKEN_LENGTH = 48

type Action = 'info' | 'text' | 'list'
interface Pending {
  id: string
  action: Action
  payload: Record<string, unknown>
  resolve: (value: BrowserResult) => void
  timer: NodeJS.Timeout
}
export interface BrowserResult {
  ok: boolean
  data?: unknown
  error?: string
}

let server: Server | null = null
let port: number | null = null
let lastSeen = 0
const pending: Pending[] = []
const inflight = new Map<string, Pending>()
let waiter: { res: ServerResponse; timer: NodeJS.Timeout } | null = null

const token = (): string => {
  const current = getSecret(SECRET)
  if (current && /^[a-f0-9]{48}$/.test(current)) return current
  const next = randomBytes(TOKEN_LENGTH / 2).toString('hex')
  setSecret(SECRET, next)
  return next
}

const authorized = (req: IncomingMessage): boolean => {
  const host = String(req.headers.host ?? '')
  if (!new RegExp(`^(?:127\\.0\\.0\\.1|localhost):${port}$`).test(host)) return false
  const origin = req.headers.origin
  if (origin && !/^(?:chrome|moz)-extension:\/\//.test(origin)) return false
  const header = String(req.headers.authorization ?? '')
  const expected = token()
  const actual = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '')
  const wanted = Buffer.from(expected)
  return actual.length === wanted.length && timingSafeEqual(actual, wanted)
}

async function body(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const b = Buffer.from(chunk as Uint8Array)
    size += b.length
    if (size > MAX_BODY) return null
    chunks.push(b)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const data = JSON.stringify(value)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) })
  res.end(data)
}

function nextAction(res: ServerResponse): void {
  const item = pending.shift()
  if (!item) {
    res.writeHead(204)
    res.end()
    return
  }
  clearTimeout(item.timer)
  json(res, 200, { id: item.id, action: item.action, ...item.payload })
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!authorized(req)) {
    json(res, 401, { error: 'não autorizado' })
    return
  }
  if (req.method === 'GET' && req.url === '/v1/status') {
    json(res, 200, { ok: true, connected: Date.now() - lastSeen < 40_000 })
    return
  }
  lastSeen = Date.now()
  if (req.method === 'GET' && req.url === '/v1/next') {
    if (waiter) {
      waiter.res.end()
      clearTimeout(waiter.timer)
    }
    const timer = setTimeout(() => {
      if (!waiter || waiter.timer !== timer) return
      waiter = null
      res.writeHead(204)
      res.end()
    }, MAX_WAIT)
    const item = pending.shift()
    if (item) {
      clearTimeout(item.timer)
      inflight.set(item.id, item)
      json(res, 200, { id: item.id, action: item.action, ...item.payload })
    } else {
      waiter = { res, timer }
    }
    return
  }
  if (req.method === 'POST' && req.url === '/v1/result') {
    const value = await body(req)
    if (!value || typeof value.id !== 'string' || typeof value.ok !== 'boolean') {
      json(res, 400, { error: 'corpo inválido' })
      return
    }
    const item = inflight.get(value.id)
    if (!item) {
      json(res, 404, { error: 'pedido expirado' })
      return
    }
    inflight.delete(value.id)
    clearTimeout(item.timer)
    item.resolve({ ok: value.ok, data: value.data, error: typeof value.error === 'string' ? value.error : undefined })
    json(res, 200, { ok: true })
    return
  }
  json(res, 404, { error: 'rota não encontrada' })
}

async function listen(): Promise<void> {
  if (server) return
  token()
  for (const candidate of PORTS) {
    const attempt = createServer((req, res) => void handle(req, res))
    try {
      await new Promise<void>((resolve, reject) => {
        attempt.once('error', reject)
        attempt.listen(candidate, '127.0.0.1', resolve)
      })
      server = attempt
      port = candidate
      return
    } catch {
      attempt.close()
    }
  }
  throw new Error('Não foi possível abrir a ponte do navegador.')
}

export async function setBrowserBridgeEnabled(enabled: boolean): Promise<void> {
  if (enabled) await listen()
  else stopBrowserBridge()
}

export function stopBrowserBridge(): void {
  lastSeen = 0
  if (waiter) {
    clearTimeout(waiter.timer)
    waiter.res.writeHead(204)
    waiter.res.end()
    waiter = null
  }
  for (const item of pending.splice(0)) {
    clearTimeout(item.timer)
    item.resolve({ ok: false, error: 'ponte desligada' })
  }
  for (const item of inflight.values()) {
    clearTimeout(item.timer)
    item.resolve({ ok: false, error: 'ponte desligada' })
  }
  inflight.clear()
  server?.close()
  server = null
  port = null
}

export function browserBridgeInfo(): { enabled: boolean; port: number | null; connected: boolean; pairingCode: string | null } {
  const current = server && port ? token() : null
  return {
    enabled: Boolean(server),
    port,
    connected: Date.now() - lastSeen < 40_000,
    pairingCode: current && port ? `QUETI-${port}-${current}` : null
  }
}

export function regenerateBrowserBridgeCode(): { pairingCode: string | null } {
  deleteSecret(SECRET)
  lastSeen = 0
  if (!server || !port) return { pairingCode: null }
  const next = token()
  return { pairingCode: `QUETI-${port}-${next}` }
}

export function requestBrowser(action: Action, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<BrowserResult> {
  if (!server || !port) return Promise.resolve({ ok: false, error: 'ponte do navegador desligada' })
  return new Promise((resolve) => {
    const id = createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 24)
    const timer = setTimeout(() => {
      const index = pending.findIndex((p) => p.id === id)
      if (index >= 0) pending.splice(index, 1)
      inflight.delete(id)
      resolve({ ok: false, error: 'a extensão não respondeu a tempo' })
    }, ACTION_TIMEOUT)
    pending.push({ id, action, payload, resolve, timer })
    if (waiter) {
      const current = waiter
      waiter = null
      clearTimeout(current.timer)
      const item = pending.shift()
      if (item) {
        inflight.set(item.id, item)
        json(current.res, 200, { id: item.id, action: item.action, ...item.payload })
      }
    }
    if (signal) {
      const cancel = () => {
        clearTimeout(timer)
        const index = pending.findIndex((p) => p.id === id)
        if (index >= 0) pending.splice(index, 1)
        resolve({ ok: false, error: 'ação cancelada' })
      }
      if (signal.aborted) cancel()
      else signal.addEventListener('abort', cancel, { once: true })
    }
  })
}

export function initBrowserBridge(): void {
  if (getSettings().browserBridge) void listen().catch((error) => console.error(error))
}
