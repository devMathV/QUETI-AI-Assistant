import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { dbPath, num, openDb, str, transaction } from './db'
import { getSettings } from './settings'
import type { ChatAction, ChatMessage, ChatRole, ConversationSummary, Source } from '../shared/types'

const DAY_MS = 24 * 60 * 60 * 1000

function parseSources(raw: string): Source[] {
  try {
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) return []
    return list.flatMap((s) =>
      s && typeof s.title === 'string' && typeof s.url === 'string' && /^https?:\/\//.test(s.url) ? [{ title: s.title, url: s.url }] : []
    )
  } catch {
    return []
  }
}

function parseNames(raw: string): string[] {
  try {
    const list = JSON.parse(raw) as unknown
    return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

export function createConversation(title: string): string | null {
  const db = openDb()
  if (!db) return null
  const id = randomUUID()
  const now = Date.now()
  db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, title, now, now)
  return id
}

export function saveMessage(conversationId: string, m: ChatMessage): void {
  const db = openDb()
  if (!db) return
  transaction((d) => {
    d.prepare(
      `INSERT INTO messages (id, conversation_id, role, text, action, ts, sources, attachments) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET text = excluded.text, sources = excluded.sources, attachments = excluded.attachments`
    ).run(m.id, conversationId, m.role, m.text, m.action ?? null, m.ts, m.sources?.length ? JSON.stringify(m.sources) : null, m.attachments?.length ? JSON.stringify(m.attachments) : null)
    d.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), conversationId)
  })
}

export function loadMessages(conversationId: string): ChatMessage[] | null {
  const db = openDb()
  if (!db) return null
  const exists = db.prepare('SELECT 1 AS ok FROM conversations WHERE id = ?').get(conversationId)
  if (!exists) return null
  return db
    .prepare('SELECT id, role, text, action, ts, sources, attachments FROM messages WHERE conversation_id = ? ORDER BY rowid')
    .all(conversationId)
    .map((r) => ({
      id: str(r.id),
      role: str(r.role) as ChatRole,
      text: str(r.text),
      ts: num(r.ts),
      ...(r.action ? { action: str(r.action) as ChatAction } : {}),
      ...(r.sources ? { sources: parseSources(str(r.sources)) } : {}),
      ...(r.attachments ? { attachments: parseNames(str(r.attachments)) } : {})
    }))
}

export function listConversations(currentId: string | null): ConversationSummary[] {
  const db = openDb()
  if (!db) return []
  return db
    .prepare(
      `SELECT c.id, c.title, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n
         FROM conversations c ORDER BY c.updated_at DESC LIMIT 200`
    )
    .all()
    .map((r) => ({
      id: str(r.id),
      title: str(r.title),
      updatedAt: num(r.updated_at),
      messageCount: num(r.n),
      current: str(r.id) === currentId
    }))
}

export function deleteConversation(id: string): void {
  const db = openDb()
  if (!db) return
  transaction((d) => {
    d.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id)
    d.prepare('DELETE FROM conversations WHERE id = ?').run(id)
  })
}

export function deleteAllConversations(): void {
  const db = openDb()
  if (!db) return
  transaction((d) => {
    d.exec('DELETE FROM messages')
    d.exec('DELETE FROM conversations')
  })
  db.exec('VACUUM')
}

export function countOlderThan(days: number): number {
  const db = openDb()
  if (!db || days <= 0) return 0
  return num(db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE updated_at < ?').get(Date.now() - days * DAY_MS)?.n)
}

export function purgeByRetention(): number {
  const days = getSettings().retentionDays
  const db = openDb()
  if (!db || days <= 0) return 0
  const cutoff = Date.now() - days * DAY_MS
  const removed = countOlderThan(days)
  if (removed > 0) {
    transaction((d) => {
      d.prepare('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE updated_at < ?)').run(cutoff)
      d.prepare('DELETE FROM conversations WHERE updated_at < ?').run(cutoff)
    })
    db.exec('VACUUM')
  }
  return removed
}

export function counts(): { conversations: number; messages: number; memories: number; sizeBytes: number } {
  const db = openDb()
  if (!db) return { conversations: 0, messages: 0, memories: 0, sizeBytes: 0 }
  let sizeBytes = 0
  try {
    sizeBytes = statSync(dbPath()).size
  } catch {

  }
  return {
    conversations: num(db.prepare('SELECT COUNT(*) AS n FROM conversations').get()?.n),
    messages: num(db.prepare('SELECT COUNT(*) AS n FROM messages').get()?.n),
    memories: num(db.prepare('SELECT COUNT(*) AS n FROM memories').get()?.n),
    sizeBytes
  }
}

export function exportConversations(): { id: string; title: string; createdAt: number; updatedAt: number; messages: ChatMessage[] }[] {
  const db = openDb()
  if (!db) return []
  return db
    .prepare('SELECT id, title, created_at, updated_at FROM conversations ORDER BY created_at')
    .all()
    .map((r) => ({
      id: str(r.id),
      title: str(r.title),
      createdAt: num(r.created_at),
      updatedAt: num(r.updated_at),
      messages: loadMessages(str(r.id)) ?? []
    }))
}
