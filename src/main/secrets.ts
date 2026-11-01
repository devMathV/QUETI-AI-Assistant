import { app, safeStorage } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Chaves de API ficam criptografadas com o armazenamento seguro do sistema
// (no Windows, DPAPI: só o seu usuário do Windows consegue descriptografar).
// Limitação honesta: outros programas rodando como o MESMO usuário do Windows
// também poderiam pedir a descriptografia. Não é um cofre contra malware.
// Nunca gravamos a chave em texto puro: sem armazenamento seguro, ela não é salva.

type Store = Record<string, string>

const filePath = (): string => join(app.getPath('userData'), 'secrets.json')

function read(): Store {
  try {
    const raw = JSON.parse(readFileSync(filePath(), 'utf8')) as unknown
    return typeof raw === 'object' && raw !== null ? (raw as Store) : {}
  } catch {
    return {}
  }
}

function write(store: Store): void {
  mkdirSync(dirname(filePath()), { recursive: true })
  const tmp = `${filePath()}.tmp`
  writeFileSync(tmp, JSON.stringify(store), 'utf8')
  renameSync(tmp, filePath())
}

export const secretsAvailable = (): boolean => safeStorage.isEncryptionAvailable()

export function setSecret(name: string, value: string): void {
  if (!secretsAvailable()) throw new Error('O Windows não disponibilizou o armazenamento seguro de credenciais.')
  const store = read()
  store[name] = safeStorage.encryptString(value).toString('base64')
  write(store)
}

export function getSecret(name: string): string | null {
  const encrypted = read()[name]
  if (!encrypted || !secretsAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    return null // arquivo corrompido ou de outro usuário do Windows
  }
}

export const hasSecret = (name: string): boolean => typeof read()[name] === 'string'

export function deleteSecret(name: string): void {
  const store = read()
  delete store[name]
  write(store)
}
