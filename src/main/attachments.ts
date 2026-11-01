import { BrowserWindow, dialog } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { relevance } from './memory'
import { setCompactAutoHideSuspended } from './windows'
import type { AttachmentInfo, AttachResult } from '../shared/types'

interface Attachment {
  id: string
  name: string
  kind: 'file' | 'git'
  source: string
  text: string
}

const MAX_FILES = 6
const MAX_FILE_BYTES = 1_000_000
const MAX_GIT_CHARS = 400_000
const CHUNK_CHARS = 1200

const TEXT_EXTENSIONS = [
  'txt', 'md', 'json', 'csv', 'tsv', 'log', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'go',
  'rs', 'rb', 'php', 'swift', 'html', 'htm', 'css', 'scss', 'sql', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'xml', 'sh', 'ps1', 'bat', 'cmd',
  'vue', 'svelte', 'gitignore', 'env', 'lock'
]
const TEXT_NAMES = ['dockerfile', 'makefile', 'license', 'readme', 'procfile']

let attachments: Attachment[] = []
const listeners = new Set<(list: AttachmentInfo[]) => void>()

const info = (a: Attachment): AttachmentInfo => ({ id: a.id, name: a.name, kind: a.kind, chars: a.text.length })
export const listAttachments = (): AttachmentInfo[] => attachments.map(info)
const changed = (): void => listeners.forEach((cb) => cb(listAttachments()))
export function onAttachmentsChanged(cb: (list: AttachmentInfo[]) => void): void {
  listeners.add(cb)
}

export function removeAttachment(id: string): void {
  attachments = attachments.filter((a) => a.id !== id)
  changed()
}

export function clearAttachments(): void {
  if (attachments.length === 0) return
  attachments = []
  changed()
}

async function openDialog(win: BrowserWindow | null, options: Electron.OpenDialogOptions): Promise<string[] | null> {

  setCompactAutoHideSuspended(true)
  try {
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths
  } finally {
    setCompactAutoHideSuspended(false)
  }
}

const isTextFile = (path: string): boolean => {
  const ext = extname(path).slice(1).toLowerCase()
  return TEXT_EXTENSIONS.includes(ext) || (ext === '' && TEXT_NAMES.includes(basename(path).toLowerCase())) || TEXT_EXTENSIONS.includes(basename(path).toLowerCase().replace(/^\./, ''))
}

export async function pickFiles(win: BrowserWindow | null): Promise<AttachResult> {
  const paths = await openDialog(win, {
    title: 'Anexar arquivos',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Texto e código', extensions: TEXT_EXTENSIONS }]
  })
  if (!paths) return { ok: false, canceled: true, message: '' }

  let added = 0
  let overLimit = 0
  const skipped: string[] = []
  for (const path of paths) {
    const name = basename(path)
    if (attachments.some((a) => a.source === path)) continue
    if (attachments.length >= MAX_FILES) {
      overLimit++
      continue
    }
    if (!isTextFile(path)) {
      skipped.push(`${name} (tipo ainda não suportado)`)
      continue
    }
    try {
      const st = await stat(path)
      if (!st.isFile() || st.size > MAX_FILE_BYTES) {
        skipped.push(`${name} (maior que ${MAX_FILE_BYTES / 1_000_000} MB)`)
        continue
      }
      const content = await readFile(path, 'utf8')
      if (content.includes('\u0000')) {
        skipped.push(`${name} (parece binário)`)
        continue
      }
      attachments.push({ id: randomUUID(), name, kind: 'file', source: path, text: content })
      added++
    } catch {
      skipped.push(`${name} (não foi possível ler)`)
    }
  }
  changed()
  const parts = [added > 0 ? `${added} ${added === 1 ? 'arquivo anexado' : 'arquivos anexados'}.` : '']
  if (overLimit > 0) {
    parts.push(`Limite de ${MAX_FILES} anexos: ${overLimit} ${overLimit === 1 ? 'arquivo não foi adicionado' : 'arquivos não foram adicionados'}.`)
  }
  if (skipped.length > 0) parts.push(`Ignorados: ${skipped.join('; ')}.`)
  return { ok: added > 0, message: parts.filter(Boolean).join(' ') || 'Nada novo foi anexado.' }
}

function git(repo: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',

      ['-C', repo, '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '--no-optional-locks', ...args],
      { timeout: 15_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' } },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    )
  })
}

export async function pickGit(win: BrowserWindow | null): Promise<AttachResult> {
  const paths = await openDialog(win, { title: 'Escolha a pasta do repositório Git', properties: ['openDirectory'] })
  if (!paths) return { ok: false, canceled: true, message: '' }
  const repo = paths[0]
  try {
    await git(repo, ['rev-parse', '--is-inside-work-tree'])
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
    return { ok: false, message: missing ? 'O Git não foi encontrado no seu computador (não está no PATH).' : 'Esta pasta não é um repositório Git.' }
  }
  try {
    const safe = ['--no-color', '--no-ext-diff', '--no-textconv']
    const [status, unstaged, staged, log] = await Promise.all([
      git(repo, ['status', '--short', '--branch']),
      git(repo, ['diff', ...safe]),
      git(repo, ['diff', '--cached', ...safe]),
      git(repo, ['log', '-5', '--oneline', '--no-color'])
    ])
    const text = [
      `# Status\n${status}`,
      `# Últimos commits\n${log}`,
      `# Alterações ainda não preparadas (git diff)\n${unstaged || '(nenhuma)\n'}`,
      `# Alterações preparadas (git diff --cached)\n${staged || '(nenhuma)\n'}`
    ]
      .join('\n')
      .slice(0, MAX_GIT_CHARS)
    const name = `Git: ${basename(repo)}`
    attachments = attachments.filter((a) => !(a.kind === 'git' && a.source === repo))
    if (attachments.length >= MAX_FILES) return { ok: false, message: `Limite de ${MAX_FILES} anexos atingido.` }
    attachments.push({ id: randomUUID(), name, kind: 'git', source: repo, text })
    changed()
    return { ok: true, message: `Alterações de “${basename(repo)}” anexadas (somente leitura; nada foi modificado).` }
  } catch {
    return { ok: false, message: 'Não foi possível ler o repositório.' }
  }
}

function pickExcerpts(text: string, query: string, budget: number): { text: string; truncated: boolean } {
  if (text.length <= budget) return { text, truncated: false }
  const lines = text.split('\n')
  const chunks: { start: number; end: number; body: string; score: number }[] = []
  let start = 0
  let body = ''
  lines.forEach((line, i) => {
    body += `${line}\n`
    if (body.length >= CHUNK_CHARS || i === lines.length - 1) {
      chunks.push({ start: start + 1, end: i + 1, body, score: relevance(query, body) })
      start = i + 1
      body = ''
    }
  })
  const chosen = new Set<number>([0])
  let used = chunks[0]?.body.length ?? 0
  const ranked = chunks.map((c, i) => ({ c, i })).sort((a, b) => b.c.score - a.c.score || a.i - b.i)
  for (const { c, i } of ranked) {
    if (chosen.has(i) || c.score === 0) continue
    if (used + c.body.length > budget) continue
    chosen.add(i)
    used += c.body.length
  }
  const out = [...chosen]
    .sort((a, b) => a - b)
    .map((i) => `[linhas ${chunks[i].start}-${chunks[i].end} de ${lines.length}]\n${chunks[i].body}`)
    .join('\n[...]\n')
  return { text: out, truncated: true }
}

export function buildAttachmentContext(query: string, budget: number): { text: string; note?: string } | null {
  if (attachments.length === 0) return null
  const each = Math.floor(budget / attachments.length)
  const truncatedNames: string[] = []
  const parts = attachments.map((a, n) => {
    const r = pickExcerpts(a.text, query, each)
    if (r.truncated) truncatedNames.push(a.name)
    return `[ANEXO ${n + 1}: ${a.name}]\n${r.text}`
  })
  return {
    text: parts.join('\n\n'),
    note: truncatedNames.length > 0 ? `Arquivo grande: enviei à IA só os trechos mais relevantes de ${truncatedNames.join(', ')}.` : undefined
  }
}
