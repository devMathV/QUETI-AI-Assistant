import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

type Row = Record<string, unknown>
interface Statement {
  run(...params: unknown[]): unknown
  get(...params: unknown[]): Row | undefined
  all(...params: unknown[]): Row[]
}
export interface Db {
  exec(sql: string): void
  prepare(sql: string): Statement
  close(): void
}

const MIGRATIONS: string[] = [
  `CREATE TABLE conversations (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE messages (
     id TEXT PRIMARY KEY,
     conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     role TEXT NOT NULL,
     text TEXT NOT NULL,
     action TEXT,
     ts INTEGER NOT NULL
   );
   CREATE INDEX idx_messages_conversation ON messages(conversation_id);
   CREATE TABLE memories (
     id TEXT PRIMARY KEY,
     content TEXT NOT NULL,
     always INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );`,
  `ALTER TABLE messages ADD COLUMN sources TEXT;`,
  `ALTER TABLE messages ADD COLUMN attachments TEXT;`
]

let db: Db | null = null
let initError: string | null = null

export const dbFolder = (): string => app.getPath('userData')
export const dbPath = (): string => join(dbFolder(), 'assistente.db')
export const dbError = (): string | null => initError

function migrate(d: Db): void {
  const current = Number(d.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  for (let v = current; v < MIGRATIONS.length; v++) {
    d.exec('BEGIN')
    try {
      d.exec(MIGRATIONS[v])
      d.exec(`PRAGMA user_version = ${v + 1}`)
      d.exec('COMMIT')
    } catch (error) {
      d.exec('ROLLBACK')
      throw error
    }
  }
}

export function openDb(): Db | null {
  if (db) return db
  if (initError) return null
  try {
    const getBuiltin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule
    const sqlite = getBuiltin?.('node:sqlite') as { DatabaseSync?: new (path: string) => Db } | undefined
    if (!sqlite?.DatabaseSync) throw new Error('esta versão do Electron não inclui o módulo SQLite (node:sqlite)')
    mkdirSync(dbFolder(), { recursive: true })
    const d = new sqlite.DatabaseSync(dbPath())
    d.exec('PRAGMA foreign_keys = ON')

    d.exec('PRAGMA secure_delete = ON')
    migrate(d)
    db = d
  } catch (error) {
    initError = error instanceof Error ? error.message : String(error)
    db = null
    console.error('Armazenamento local indisponível:', initError)
  }
  return db
}

export function closeDb(): void {
  try {
    db?.close()
  } catch {

  }
  db = null
}

export function transaction<T>(fn: (d: Db) => T): T {
  const d = openDb()
  if (!d) throw new Error('Armazenamento local indisponível.')
  d.exec('BEGIN')
  try {
    const result = fn(d)
    d.exec('COMMIT')
    return result
  } catch (error) {
    d.exec('ROLLBACK')
    throw error
  }
}

export const num = (v: unknown): number => Number(v ?? 0)
export const str = (v: unknown): string => String(v ?? '')
