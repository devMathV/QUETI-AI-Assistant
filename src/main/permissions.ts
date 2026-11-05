import { BrowserWindow, app, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, isAbsolute, parse, relative, resolve } from 'node:path'
import { num, openDb, str } from './db'
import { broadcast, setCompactAutoHideSuspended } from './windows'
import type { AttachResult, Grant, GrantKind, ToolLogEntry } from '../shared/types'

export type Decision = 'deny' | 'once' | 'always'

export const BLOCKED_WRITE_EXT = ['.exe', '.dll', '.bat', '.cmd', '.ps1', '.vbs', '.msi', '.scr', '.lnk', '.com', '.reg']
export const SENSITIVE_FILE =
  /(^|[\\/])(\.env(\..*)?|\.npmrc|\.netrc|\.git-credentials|id_(rsa|ed25519|ecdsa|dsa).*|.*\.(pem|pfx|p12|key|kdbx|ppk)|credentials(\..*)?|secrets?\.json)$/i

const notify = (): void => broadcast('permissions:changed')
let permissionRevision = 0

export const getPermissionRevision = (): number => permissionRevision

function toGrant(r: Record<string, unknown>): Grant {
  return { id: str(r.id), kind: str(r.kind) as GrantKind, target: str(r.target), label: str(r.label), createdAt: num(r.created_at) }
}

export function listGrants(): Grant[] {
  const db = openDb()
  return db ? db.prepare('SELECT * FROM permissions ORDER BY kind, label').all().map(toGrant) : []
}

export function addGrant(kind: GrantKind, target: string, label: string): boolean {
  const db = openDb()
  if (!db) return false
  db.prepare('INSERT OR IGNORE INTO permissions (id, kind, target, label, created_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(),
    kind,
    target,
    label,
    Date.now()
  )
  permissionRevision++
  notify()
  return true
}

export function revokeGrant(id: string): void {
  openDb()?.prepare('DELETE FROM permissions WHERE id = ?').run(id)
  permissionRevision++
  notify()
}

export function revokeAll(): void {
  const db = openDb()
  if (!db) return
  db.exec('DELETE FROM permissions')
  db.exec('DELETE FROM tool_log')
  permissionRevision++
  notify()
}

export const hasGrant = (kind: GrantKind, target: string): boolean =>
  Boolean(openDb()?.prepare('SELECT 1 AS ok FROM permissions WHERE kind = ? AND target = ?').get(kind, target))

export function logTool(tool: string, target: string, outcome: ToolLogEntry['outcome'], detail = ''): void {
  try {
    const db = openDb()
    if (!db) return
    db.prepare('INSERT INTO tool_log (ts, tool, target, outcome, detail) VALUES (?, ?, ?, ?, ?)').run(
      Date.now(),
      tool,
      target.slice(0, 300),
      outcome,
      detail.slice(0, 300)
    )
    db.exec('DELETE FROM tool_log WHERE id NOT IN (SELECT id FROM tool_log ORDER BY id DESC LIMIT 200)')
    notify()
  } catch {
    return
  }
}

export function listLog(limit = 50): ToolLogEntry[] {
  const db = openDb()
  if (!db) return []
  return db
    .prepare('SELECT * FROM tool_log ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((r) => ({
      id: num(r.id),
      ts: num(r.ts),
      tool: str(r.tool),
      target: str(r.target),
      outcome: str(r.outcome) as ToolLogEntry['outcome'],
      detail: str(r.detail)
    }))
}

export function clearLog(): void {
  openDb()?.exec('DELETE FROM tool_log')
  notify()
}

export async function ask(options: { message: string; detail: string; remember: boolean; warn?: boolean }): Promise<Decision> {
  const buttons = options.remember ? ['Negar', 'Permitir só desta vez', 'Sempre permitir'] : ['Negar', 'Permitir']
  setCompactAutoHideSuspended(true)
  try {
    const config = {
      type: options.warn ? ('warning' as const) : ('question' as const),
      buttons,
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Permissão do QUETI',
      message: options.message,
      detail: options.detail
    }
    const parent = BrowserWindow.getFocusedWindow()
    const result = parent ? await dialog.showMessageBox(parent, config) : await dialog.showMessageBox(config)
    if (result.response === 0) return 'deny'
    return options.remember && result.response === 2 ? 'always' : 'once'
  } finally {
    setCompactAutoHideSuspended(false)
  }
}

export function hostOf(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname ? u.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

export function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return true
  if (host.includes(':') || host.startsWith('[')) return true
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}

const lower = (p: string): string => p.toLowerCase()

export function isInside(child: string, parent: string): boolean {
  const rel = relative(lower(parent), lower(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function canonical(path: string): string | null {
  try {
    return realpathSync(resolve(path))
  } catch {
    return null
  }
}

export function forbiddenFolderReason(real: string): string | null {
  if (lower(parse(real).root) === lower(real)) return 'Não é permitido autorizar a raiz de um disco.'
  const blocked = [
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
    process.env.APPDATA,
    process.env.LOCALAPPDATA,
    app.getPath('userData')
  ].filter((p): p is string => Boolean(p))
  if (blocked.some((b) => isInside(real, b)) || /[\\/]\.(ssh|aws|gnupg|azure|kube)([\\/]|$)/i.test(real)) {
    return 'Esta pasta contém arquivos do sistema ou credenciais e não pode ser autorizada.'
  }
  if (lower(real) === lower(homedir())) return 'Escolha uma subpasta (por exemplo, Documentos) em vez da pasta pessoal inteira.'
  return null
}

export function findFolderGrant(folder: string, needWrite: boolean): Grant | null {
  for (const g of listGrants()) {
    const fits = g.kind === 'folder_write' || (!needWrite && g.kind === 'folder_read')
    if (fits && isInside(folder, g.target)) return g
  }
  return null
}

async function pick(win: BrowserWindow | null, options: Electron.OpenDialogOptions): Promise<string | null> {
  setCompactAutoHideSuspended(true)
  try {
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  } finally {
    setCompactAutoHideSuspended(false)
  }
}

export function addSiteGrant(domain: string, mode: 'open' | 'read'): AttachResult {
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host.length > 120 || isPrivateHost(host)) {
    return { ok: false, message: 'Endereço inválido. Use algo como exemplo.com.br.' }
  }
  const added = addGrant(mode === 'open' ? 'site' : 'site_read', host, host)
  return { ok: added, message: added ? `Site ${host} autorizado para ${mode === 'open' ? 'abrir' : 'ler o conteúdo'}.` : 'Armazenamento local indisponível.' }
}

export async function addAppGrant(win: BrowserWindow | null): Promise<AttachResult> {
  const path = await pick(win, {
    title: 'Escolha o aplicativo a autorizar',
    properties: ['openFile'],
    filters: [{ name: 'Aplicativos', extensions: ['exe', 'lnk'] }]
  })
  if (!path) return { ok: false, canceled: true, message: '' }
  const label = basename(path, extname(path))
  const added = addGrant('app', path, label)
  return { ok: added, message: added ? `Aplicativo “${label}” autorizado.` : 'Armazenamento local indisponível.' }
}

export async function addFolderGrant(win: BrowserWindow | null, write: boolean): Promise<AttachResult> {
  const path = await pick(win, { title: 'Escolha a pasta a autorizar', properties: ['openDirectory'] })
  if (!path) return { ok: false, canceled: true, message: '' }
  const real = canonical(path)
  if (!real) return { ok: false, message: 'Não foi possível abrir essa pasta.' }
  const reason = forbiddenFolderReason(real)
  if (reason) return { ok: false, message: reason }
  if (write) {
    const decision = await ask({
      message: 'Permitir que o QUETI crie e altere arquivos nesta pasta?',
      detail: `${real}\n\nCada criação, alteração ou exclusão ainda pedirá a sua confirmação, e uma cópia do arquivo original é guardada antes de substituí-lo.`,
      remember: false,
      warn: true
    })
    if (decision === 'deny') return { ok: false, canceled: true, message: '' }
  }
  const added = addGrant(write ? 'folder_write' : 'folder_read', real, basename(real) || real)
  return { ok: added, message: added ? `Pasta “${basename(real)}” autorizada para ${write ? 'leitura e escrita' : 'leitura'}.` : 'Armazenamento local indisponível.' }
}
