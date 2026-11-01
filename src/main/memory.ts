import { randomUUID } from 'node:crypto'
import { num, openDb, str } from './db'
import type { MemoryItem, MemoryResult } from '../shared/types'

// Memória pessoal: só o que o usuário pede para guardar (pela tela de Memória
// ou escrevendo "Lembre-se de que ..." no chat). Nada é guardado sozinho.
// Fica no banco local; ao responder, enviamos ao provedor apenas os itens
// relevantes à pergunta (mais os marcados como "sempre"), nunca a memória inteira.

const MAX_ITEMS = 200
const MAX_CHARS = 500

const listeners = new Set<() => void>()
export function onMemoryChanged(cb: () => void): void {
  listeners.add(cb)
}
export const notifyMemoryChanged = (): void => listeners.forEach((cb) => cb())

const STOPWORDS = new Set(
  ('de da do das dos que para com uma uns por como mais mas nao sim ele ela isso esse essa este esta qual quais minha meu meus ' +
    'minhas sobre onde quando ser ter fazer voce pode posso preciso quero gostaria favor tem foi sao era sua seu seus suas ' +
    'num numa nos nas aos pelo pela entre ate ainda ja so tambem muito pouco').split(' ')
)

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Raízes das palavras (5 primeiras letras): aproxima "programar/programação/programa". */
function stems(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of normalize(text).split(/[^a-z0-9]+/)) {
    if (w.length >= 3 && !STOPWORDS.has(w)) out.add(w.slice(0, 5))
  }
  return out
}

function toItem(r: Record<string, unknown>): MemoryItem {
  return {
    id: str(r.id),
    content: str(r.content),
    always: num(r.always) === 1,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at)
  }
}

export function listMemories(): MemoryItem[] {
  const db = openDb()
  if (!db) return []
  return db.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all().map(toItem)
}

function validate(content: unknown): string | null {
  if (typeof content !== 'string' || content.trim().length === 0) return 'Escreva o que deve ser lembrado.'
  if (content.trim().length > MAX_CHARS) return `O texto passa de ${MAX_CHARS} caracteres. Resuma a informação.`
  return null
}

export function addMemory(content: unknown, always: boolean): MemoryResult {
  const problem = validate(content)
  if (problem) return { ok: false, error: problem }
  const db = openDb()
  if (!db) return { ok: false, error: 'Armazenamento local indisponível.' }
  const text = (content as string).trim()
  const existing = listMemories()
  // Evita duplicatas: se já existe algo igual, apenas atualiza a data.
  const dup = existing.find((m) => normalize(m.content) === normalize(text))
  if (dup) {
    db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(Date.now(), dup.id)
    notifyMemoryChanged()
    return { ok: true, item: { ...dup, updatedAt: Date.now() }, duplicate: true }
  }
  if (existing.length >= MAX_ITEMS) return { ok: false, error: `Limite de ${MAX_ITEMS} itens atingido. Apague algum para adicionar outro.` }
  const now = Date.now()
  const id = randomUUID()
  db.prepare('INSERT INTO memories (id, content, always, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, text, always ? 1 : 0, now, now)
  notifyMemoryChanged()
  return { ok: true, item: { id, content: text, always, createdAt: now, updatedAt: now } }
}

export function updateMemory(id: string, patch: { content?: unknown; always?: unknown }): MemoryResult {
  const db = openDb()
  if (!db) return { ok: false, error: 'Armazenamento local indisponível.' }
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id)
  if (!row) return { ok: false, error: 'Item não encontrado.' }
  const current = toItem(row)
  let content = current.content
  if (patch.content !== undefined) {
    const problem = validate(patch.content)
    if (problem) return { ok: false, error: problem }
    content = (patch.content as string).trim()
  }
  const always = typeof patch.always === 'boolean' ? patch.always : current.always
  const now = Date.now()
  db.prepare('UPDATE memories SET content = ?, always = ?, updated_at = ? WHERE id = ?').run(content, always ? 1 : 0, now, id)
  notifyMemoryChanged()
  return { ok: true, item: { ...current, content, always, updatedAt: now } }
}

export function deleteMemory(id: string): void {
  openDb()?.prepare('DELETE FROM memories WHERE id = ?').run(id)
  notifyMemoryChanged()
}

export function deleteAllMemories(): void {
  const db = openDb()
  if (!db) return
  db.exec('DELETE FROM memories')
  db.exec('VACUUM')
  notifyMemoryChanged()
}

/**
 * Escolhe o que enviar ao provedor: itens "sempre" + os mais parecidos com a
 * pergunta (por palavras em comum), respeitando limites de quantidade e tamanho.
 * É uma heurística simples e local; não usa IA nem rede.
 */
export function selectRelevant(query: string, maxItems = 5, maxChars = 800): MemoryItem[] {
  const all = listMemories()
  if (all.length === 0) return []
  const q = stems(query)
  const scored = all
    .map((m) => {
      let score = 0
      for (const s of stems(m.content)) if (q.has(s)) score++
      return { m, score }
    })
    .filter((x) => x.m.always || x.score > 0)
    .sort((a, b) => Number(b.m.always) - Number(a.m.always) || b.score - a.score || b.m.updatedAt - a.m.updatedAt)

  const picked: MemoryItem[] = []
  let used = 0
  for (const { m } of scored) {
    if (picked.length >= maxItems || used + m.content.length > maxChars) continue
    picked.push(m)
    used += m.content.length
  }
  return picked
}

export const countMemories = (): number => num(openDb()?.prepare('SELECT COUNT(*) AS n FROM memories').get()?.n)

/** Quantas raízes de palavras o texto tem em comum com a consulta (heurística local, sem IA). */
export function relevance(query: string, text: string): number {
  const q = stems(query)
  let n = 0
  for (const s of stems(text)) if (q.has(s)) n++
  return n
}
