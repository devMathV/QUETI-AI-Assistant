import { app, net, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { isTextFile } from './attachments'
import {
  BLOCKED_WRITE_EXT,
  SENSITIVE_FILE,
  addGrant,
  ask,
  canonical,
  findFolderGrant,
  forbiddenFolderReason,
  hasGrant,
  hostOf,
  isPrivateHost,
  listGrants,
  logTool,
  getPermissionRevision
} from './permissions'
import { createGuard } from './providers/http'
import { explicitPathMatches, explicitSiteMatches, type ExplicitTargets } from './explicit'
import { requestBrowser } from './browser-bridge'
import type { ToolDefinition } from './providers/types'

export interface ToolContext {
  signal: AbortSignal
  tainted: boolean
  onceFolders: Set<string>
  onceSites: Set<string>
  permissionsHint: boolean
  explicit: ExplicitTargets
  permissionRevision: number
}

export function newToolContext(
  signal: AbortSignal,
  tainted: boolean,
  explicit: ExplicitTargets = { enabled: false, paths: [], sites: [], browserTab: false }
): ToolContext {
  return {
    signal,
    tainted,
    onceFolders: new Set(),
    onceSites: new Set(),
    permissionsHint: false,
    explicit,
    permissionRevision: getPermissionRevision()
  }
}

const object = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false
})

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'open_url',
    description: 'Abre um endereço https no navegador padrão do usuário. O site precisa estar autorizado.',
    parameters: object({ url: { type: 'string', description: 'Endereço completo, começando com https://' } }, ['url'])
  },
  {
    name: 'read_page',
    description: 'Lê o texto de uma página https de um site autorizado e devolve o conteúdo.',
    parameters: object({ url: { type: 'string', description: 'Endereço completo, começando com https://' } }, ['url'])
  },
  {
    name: 'open_app',
    description: 'Abre um aplicativo da lista de aplicativos autorizados pelo usuário.',
    parameters: object({ name: { type: 'string', description: 'Nome do aplicativo, como o usuário falou' } }, ['name'])
  },
  {
    name: 'list_folder',
    description: 'Lista os arquivos de uma pasta autorizada.',
    parameters: object({ path: { type: 'string', description: 'Caminho absoluto da pasta no Windows' } }, ['path'])
  },
  {
    name: 'read_file',
    description: 'Lê um arquivo de texto ou código de uma pasta autorizada.',
    parameters: object({ path: { type: 'string', description: 'Caminho absoluto do arquivo no Windows' } }, ['path'])
  },
  {
    name: 'write_file',
    description: 'Cria ou substitui um arquivo de texto em uma pasta com permissão de escrita. O usuário confirma cada alteração.',
    parameters: object(
      { path: { type: 'string', description: 'Caminho absoluto do arquivo' }, content: { type: 'string', description: 'Conteúdo completo do arquivo' } },
      ['path', 'content']
    )
  },
  {
    name: 'delete_file',
    description: 'Move um arquivo para a Lixeira, em pasta com permissão de escrita. O usuário confirma cada exclusão.',
    parameters: object({ path: { type: 'string', description: 'Caminho absoluto do arquivo' } }, ['path'])
  },
  {
    name: 'list_browser_tabs',
    description: 'Lista as abas HTTP/HTTPS abertas para escolher uma aba. Só funciona com a ponte do navegador ativa.',
    parameters: object({}, [])
  },
  {
    name: 'read_browser_tab',
    description: 'Lê o texto da aba do navegador pedida pelo usuário. Nunca lê páginas de login ou gerenciadores de senhas.',
    parameters: object({ match: { type: 'string', description: 'Parte opcional do título ou endereço da aba' } }, [])
  }
]

const MAX_PAGE_BYTES = 1_000_000
const MAX_FILE_BYTES = 1_000_000
const MAX_WRITE_CHARS = 200_000
const OUTPUT_CHARS = 6000
const DENIED = 'ERRO: o usuário negou ou não autorizou esta ação. Não insista: explique ao usuário o que faltou.'
export const requiresToolConfirmation = (name: string): boolean => name === 'write_file' || name === 'delete_file'
const BLOCKED_BROWSER_HOSTS = /(^|\.)(accounts\.google\.com|login\.microsoftonline\.com|login\.live\.com|bitwarden\.com|1password\.com|lastpass\.com)$/i

const fence = (text: string): string => text.replace(/<\/?\s*dados/gi, '‹dados')
const fail = (tool: string, target: string, message: string): string => {
  logTool(tool, target, 'error', message)
  return `ERRO: ${message}`
}
const denied = (tool: string, target: string): string => {
  logTool(tool, target, 'denied')
  return DENIED
}
const text = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.slice(0, max) : '')
const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')

const toolName = (name: string): string => name.trim().split('.').pop() ?? name

function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw || '{}') as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function describeCall(name: string, raw: string): string {
  name = toolName(name)
  const a = parseArgs(raw) ?? {}
  const host = hostOf(text(a.url, 2000))
  const file = basename(text(a.path, 500))
  switch (name) {
    case 'open_url':
      return `Abrir o site ${host ?? '(endereço inválido)'}`
    case 'read_page':
      return `Ler a página de ${host ?? '(endereço inválido)'}`
    case 'open_app':
      return `Abrir o aplicativo “${text(a.name, 80)}”`
    case 'list_folder':
      return `Listar a pasta “${file}”`
    case 'read_file':
      return `Ler o arquivo “${file}”`
    case 'write_file':
      return `Criar ou alterar o arquivo “${file}”`
    case 'delete_file':
      return `Enviar para a Lixeira “${file}”`
    case 'list_browser_tabs':
      return 'Listar abas do navegador'
    case 'read_browser_tab':
      return `Ler a aba do navegador${text(a.match, 80) ? ` “${text(a.match, 80)}”` : ''}`
    default:
      return `Ferramenta desconhecida (${name.slice(0, 40)})`
  }
}

async function siteAllowed(kind: 'site' | 'site_read', host: string, ctx: ToolContext): Promise<boolean> {
  const key = `${kind}:${host}`
  if (ctx.explicit.enabled || ctx.explicit.sites.some((site) => site.replace(/^https:\/\//i, '').split('/')[0] === host)) return true
  if (hasGrant(kind, host)) return true
  if (ctx.permissionRevision === getPermissionRevision() && ctx.onceSites.has(key)) return true
  const decision = await ask({
    message: kind === 'site' ? `Permitir que o QUETI abra o site ${host}?` : `Permitir que o QUETI leia o conteúdo de ${host}?`,
    detail: 'A permissão vale somente para este endereço de site e pode ser revogada depois, em Permissões.',
    remember: true
  })
  if (decision === 'deny') return false
  if (decision === 'always') addGrant(kind, host, host)
  else {
    ctx.permissionRevision = getPermissionRevision()
    ctx.onceSites.add(key)
  }
  return true
}

async function confirmExternal(message: string, detail: string): Promise<boolean> {
  const decision = await ask({
    message,
    detail: `${detail}\n\nEsta ação foi sugerida depois de o QUETI ler conteúdo externo (web ou arquivos). Confirme somente se foi você quem pediu.`,
    remember: false,
    warn: true
  })
  return decision !== 'deny'
}

async function openUrl(a: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const url = text(a.url, 2000).trim()
  const host = hostOf(url)
  if (!host) return fail('open_url', url, 'endereço inválido (use https://)')
  if (isPrivateHost(host)) return fail('open_url', url, 'endereços locais ou de rede interna não são permitidos')
  if (!(await siteAllowed('site', host, ctx))) return denied('open_url', host)
  if (ctx.tainted && !ctx.explicit.enabled && !explicitSiteMatches(url, ctx.explicit.sites) && !(await confirmExternal('Confirmar abrir este endereço?', url))) {
    return denied('open_url', host)
  }
  await shell.openExternal(url)
  logTool('open_url', url, 'done')
  return `OK: abri ${url} no navegador padrão.`
}

async function readLimited(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let out = ''
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    out += decoder.decode(value, { stream: true })
    if (total >= max) {
      await reader.cancel()
      break
    }
  }
  return out
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\f\r]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

async function readPage(a: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const url = text(a.url, 2000).trim()
  const host = hostOf(url)
  if (!host) return fail('read_page', url, 'endereço inválido (use https://)')
  if (isPrivateHost(host)) return fail('read_page', url, 'endereços locais ou de rede interna não são permitidos')
  if (!(await siteAllowed('site_read', host, ctx))) return denied('read_page', host)

  let current = url
  for (let hop = 0; hop < 4; hop++) {
    const guard = createGuard(ctx.signal, 15_000)
    try {
      let res: Response
      try {
        res = await net.fetch(current, {
          redirect: 'manual',
          signal: guard.signal,
          headers: { Accept: 'text/html,text/plain,application/json;q=0.9', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5' }
        })
      } catch {
        return fail('read_page', url, guard.cancelled() ? 'cancelado' : 'não foi possível acessar a página')
      }
      if (res.status >= 300 && res.status < 400) {
        let next: string | null = null
        try {
          const location = res.headers.get('location')
          next = location ? new URL(location, current).toString() : null
        } catch {
          next = null
        }
        const nextHost = next ? hostOf(next) : null
        if (!next || nextHost !== host) {
          return fail('read_page', url, `a página redireciona para ${nextHost ?? 'outro endereço'}, que não está autorizado`)
        }
        current = next
        continue
      }
      if (!res.ok) return fail('read_page', url, `o site respondeu com erro ${res.status}`)
      const type = res.headers.get('content-type') ?? ''
      if (!/text\/|json|xml/i.test(type)) return fail('read_page', url, 'tipo de conteúdo não suportado')
      const raw = await readLimited(res, MAX_PAGE_BYTES)
      const content = /html/i.test(type) ? htmlToText(raw) : raw
      ctx.tainted = true
      logTool('read_page', url, 'done')
      return `<dados tipo="pagina" url="${current}">\n${fence(content.slice(0, OUTPUT_CHARS))}\n</dados>`
    } finally {
      guard.dispose()
    }
  }
  return fail('read_page', url, 'redirecionamentos demais')
}

async function openApp(a: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const wanted = text(a.name, 100).trim()
  if (!wanted) return fail('open_app', '', 'nome inválido')
  const apps = listGrants().filter((g) => g.kind === 'app')
  const key = norm(wanted)
  const match = apps.find((g) => norm(g.label) === key) ?? (key.length >= 3 ? apps.find((g) => norm(g.label).includes(key)) : undefined)
  if (!match) {
    ctx.permissionsHint = true
    return fail('open_app', wanted, 'aplicativo não autorizado. Peça ao usuário para adicioná-lo em Permissões → Aplicativos.')
  }
  if (!existsSync(match.target)) return fail('open_app', match.label, 'o arquivo do aplicativo não existe mais')
  if (ctx.tainted && !ctx.explicit.enabled && !(await confirmExternal('Confirmar abrir este aplicativo?', match.label))) return denied('open_app', match.label)
  const error = await shell.openPath(match.target)
  if (error) return fail('open_app', match.label, error)
  logTool('open_app', match.label, 'done')
  return `OK: abri ${match.label}.`
}

async function folderAccess(folder: string, write: boolean, ctx: ToolContext): Promise<string | null> {
  const reason = forbiddenFolderReason(folder)
  if (reason) return reason
  if (findFolderGrant(folder, write)) return null
  if (!write && (ctx.explicit.enabled || ctx.explicit.paths.some((path) => explicitPathMatches(folder, [path])))) return null
  const key = folder.toLowerCase()
  const currentRevision = getPermissionRevision()
  if (
    ctx.permissionRevision === currentRevision &&
    (ctx.onceFolders.has(`w:${key}`) || (!write && ctx.onceFolders.has(`r:${key}`)))
  ) {
    return null
  }
  const decision = await ask({
    message: write ? 'Permitir ESCRITA nesta pasta?' : 'Permitir LEITURA desta pasta?',
    detail: `${folder}\n\n${
      write ? 'O QUETI poderá criar e alterar arquivos aqui, sempre com a sua confirmação a cada ação.' : 'O QUETI poderá ler arquivos desta pasta e das subpastas.'
    }`,
    remember: true,
    warn: write
  })
  if (decision === 'deny') return 'o usuário negou o acesso a esta pasta'
  if (decision === 'always') addGrant(write ? 'folder_write' : 'folder_read', folder, basename(folder) || folder)
  else {
    ctx.permissionRevision = getPermissionRevision()
    ctx.onceFolders.add(`${write ? 'w' : 'r'}:${key}`)
  }
  return null
}

function absolutePath(value: unknown): string | null {
  const p = text(value, 500).trim()
  return p && isAbsolute(p) ? p : null
}

async function listFolder(a: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const given = absolutePath(a.path)
  if (!given) return fail('list_folder', text(a.path, 200), 'informe o caminho absoluto da pasta')
  const real = canonical(given)
  if (!real || !(await stat(real)).isDirectory()) return fail('list_folder', given, 'a pasta não existe')
  const error = await folderAccess(real, false, ctx)
  if (error) return error.startsWith('o usuário') ? denied('list_folder', real) : fail('list_folder', real, error)
  const entries = (await readdir(real, { withFileTypes: true })).slice(0, 100).map((e) => `${e.isDirectory() ? '[pasta]' : '[arquivo]'} ${e.name}`)
  ctx.tainted = true
  logTool('list_folder', real, 'done')
  return `<dados tipo="pasta" caminho="${real}">\n${fence(entries.join('\n') || '(vazia)')}\n</dados>`
}

async function readFileTool(a: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const given = absolutePath(a.path)
  if (!given) return fail('read_file', text(a.path, 200), 'informe o caminho absoluto do arquivo')
  const real = canonical(given)
  if (!real) return fail('read_file', given, 'o arquivo não existe')
  const info = await stat(real)
  if (!info.isFile() || info.size > MAX_FILE_BYTES) return fail('read_file', real, 'não é um arquivo ou é maior que 1 MB')
  if (SENSITIVE_FILE.test(real)) return fail('read_file', real, 'arquivo sensível: leitura bloqueada por segurança')
  if (!isTextFile(real)) return fail('read_file', real, 'tipo de arquivo ainda não suportado')
  const explicitFile = explicitPathMatches(real, ctx.explicit.paths)
  const error = ctx.explicit.enabled || explicitFile ? null : await folderAccess(dirname(real), false, ctx)
  if (error) return error.startsWith('o usuário') ? denied('read_file', real) : fail('read_file', real, error)
  const content = await readFile(real, 'utf8')
  if (content.includes('\u0000')) return fail('read_file', real, 'o arquivo parece binário')
  ctx.tainted = true
  logTool('read_file', real, 'done')
  return `<dados tipo="arquivo" nome="${basename(real)}">\n${fence(content.slice(0, OUTPUT_CHARS))}${content.length > OUTPUT_CHARS ? '\n[... truncado]' : ''}\n</dados>`
}

async function writeFileTool(a: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const given = absolutePath(a.path)
  const content = typeof a.content === 'string' ? a.content : null
  if (!given || content === null) return fail('write_file', text(a.path, 200), 'informe o caminho absoluto e o conteúdo')
  if (content.length > MAX_WRITE_CHARS) return fail('write_file', given, 'conteúdo grande demais (máximo 200.000 caracteres)')
  if (BLOCKED_WRITE_EXT.includes(extname(given).toLowerCase()) || SENSITIVE_FILE.test(given)) {
    return fail('write_file', given, 'este tipo de arquivo não pode ser criado pelo QUETI')
  }
  const parent = canonical(dirname(resolve(given)))
  if (!parent) return fail('write_file', given, 'a pasta de destino não existe')
  const target = join(parent, basename(given))
  const error = await folderAccess(parent, true, ctx)
  if (error) return error.startsWith('o usuário') ? denied('write_file', target) : fail('write_file', target, error)

  const exists = existsSync(target)
  const decision = await ask({
    message: exists ? 'Substituir este arquivo?' : 'Criar este arquivo?',
    detail:
      `${target}\n\nTamanho: ${Buffer.byteLength(content, 'utf8')} bytes\n` +
      (exists ? 'O arquivo atual será guardado em uma cópia de segurança antes de ser substituído.\n' : '') +
      (ctx.tainted ? 'ATENÇÃO: esta ação foi sugerida depois de ler conteúdo externo.\n' : '') +
      `\nInício do conteúdo:\n${content.slice(0, 300)}`,
    remember: false,
    warn: true
  })
  if (decision === 'deny') return denied('write_file', target)

  let backup = ''
  if (exists) {
    const dir = join(app.getPath('userData'), 'backups')
    mkdirSync(dir, { recursive: true })
    backup = join(dir, `${Date.now()}-${basename(target)}`)
    copyFileSync(target, backup)
  }
  const temp = `${target}.queti.tmp`
  writeFileSync(temp, content, 'utf8')
  renameSync(temp, target)
  logTool('write_file', target, 'done', backup ? `cópia: ${backup}` : 'arquivo novo')
  return `OK: ${exists ? 'substituí' : 'criei'} ${target}.${backup ? ` Cópia do original em ${backup}.` : ''}`
}

async function deleteFileTool(a: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const given = absolutePath(a.path)
  if (!given) return fail('delete_file', text(a.path, 200), 'informe o caminho absoluto do arquivo')
  const real = canonical(given)
  if (!real) return fail('delete_file', given, 'o arquivo não existe')
  if (!(await stat(real)).isFile()) return fail('delete_file', real, 'só é possível excluir arquivos (não pastas)')
  if (SENSITIVE_FILE.test(real)) return fail('delete_file', real, 'arquivo sensível: exclusão bloqueada por segurança')
  const error = await folderAccess(dirname(real), true, ctx)
  if (error) return error.startsWith('o usuário') ? denied('delete_file', real) : fail('delete_file', real, error)
  const decision = await ask({
    message: 'Enviar este arquivo para a Lixeira?',
    detail: `${real}\n\nVocê poderá restaurá-lo pela Lixeira do Windows.${ctx.tainted ? '\n\nATENÇÃO: esta ação foi sugerida depois de ler conteúdo externo.' : ''}`,
    remember: false,
    warn: true
  })
  if (decision === 'deny') return denied('delete_file', real)
  await shell.trashItem(real)
  logTool('delete_file', real, 'done')
  return `OK: enviei ${real} para a Lixeira.`
}

async function browserAccess(ctx: ToolContext): Promise<boolean> {
  if (ctx.explicit.browserTab) return true
  if (hasGrant('browser_read', 'browser')) return true
  const decision = await ask({
    message: 'Permitir que o QUETI leia uma aba do navegador?',
    detail: 'O conteúdo da aba será enviado à IA como material externo e a permissão pode ser revogada em Permissões.',
    remember: true
  })
  if (decision === 'deny') return false
  if (decision === 'always') addGrant('browser_read', 'browser', 'Abas do navegador')
  else ctx.onceSites.add('browser:read')
  return true
}

function browserHost(url: string): string | null {
  try {
    const parsed = new URL(url)
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase() : null
  } catch {
    return null
  }
}

async function listBrowserTabs(ctx: ToolContext): Promise<string> {
  if (!(await browserAccess(ctx))) return denied('list_browser_tabs', 'browser')
  const result = await requestBrowser('list', {}, ctx.signal)
  if (!result.ok) return fail('list_browser_tabs', 'browser', result.error ?? 'não foi possível listar as abas')
  return `ABAS:\n${JSON.stringify(result.data)}`
}

async function readBrowserTab(a: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (!(await browserAccess(ctx))) return denied('read_browser_tab', 'browser')
  const result = await requestBrowser('text', { match: text(a.match, 200) }, ctx.signal)
  if (!result.ok || typeof result.data !== 'object' || result.data === null) {
    return fail('read_browser_tab', 'browser', result.error ?? 'não foi possível ler a aba')
  }
  const data = result.data as { url?: unknown; title?: unknown; text?: unknown; selection?: unknown }
  const url = typeof data.url === 'string' ? data.url : ''
  const host = browserHost(url)
  if (!host) return fail('read_browser_tab', url, 'a aba não usa http ou https')
  if (BLOCKED_BROWSER_HOSTS.test(host)) return fail('read_browser_tab', url, 'esta página de login ou senha está bloqueada')
  logTool('read_browser_tab', url, 'done')
  return `ABA ${String(data.title ?? '')}\nURL: ${url}\n${String(data.text ?? '').slice(0, 30000)}\nSeleção: ${String(data.selection ?? '').slice(0, 5000)}`
}

export async function runTool(name: string, raw: string, ctx: ToolContext): Promise<string> {
  name = toolName(name)
  const args = parseArgs(raw)
  if (!args) return fail(name, '', 'argumentos inválidos')
  try {
    switch (name) {
      case 'open_url':
        return await openUrl(args, ctx)
      case 'read_page':
        return await readPage(args, ctx)
      case 'open_app':
        return await openApp(args, ctx)
      case 'list_folder':
        return await listFolder(args, ctx)
      case 'read_file':
        return await readFileTool(args, ctx)
      case 'write_file':
        return await writeFileTool(args, ctx)
      case 'delete_file':
        return await deleteFileTool(args, ctx)
      case 'list_browser_tabs':
        return await listBrowserTabs(ctx)
      case 'read_browser_tab':
        return await readBrowserTab(args, ctx)
      default:
        return fail(name, '', 'ferramenta desconhecida')
    }
  } catch (error) {
    return fail(name, '', error instanceof Error ? error.message.slice(0, 200) : 'falha inesperada')
  }
}
