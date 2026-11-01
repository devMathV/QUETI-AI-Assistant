import { BrowserWindow, app, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { startNewConversation } from './assistant'
import { notifyHistoryChanged } from './chat-store'
import { dbError, dbFolder, dbPath, openDb } from './db'
import { counts, countOlderThan, deleteAllConversations, exportConversations } from './history'
import { deleteAllMemories, listMemories, notifyMemoryChanged } from './memory'
import { GROQ_SECRET } from './providers'
import { deleteSecret } from './secrets'
import { getSettings, resetSettings } from './settings'
import { aiChanged } from './ai-config'
import { applySettingsEffects, broadcast } from './windows'
import type { DataAction, DataInfo } from '../shared/types'

// Exportar e apagar dados pessoais. Toda ação destrutiva é confirmada em uma
// caixa de diálogo NATIVA do sistema (criada pelo processo principal), que a
// interface não consegue simular nem pular.

async function confirmDestructive(win: BrowserWindow | null, message: string, detail: string, action: string): Promise<boolean> {
  const options = {
    type: 'warning' as const,
    buttons: ['Cancelar', action],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Confirmar',
    message,
    detail
  }
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
  return result.response === 1
}

export function dataInfo(): DataInfo {
  const available = openDb() !== null
  const c = counts()
  return {
    folder: dbFolder(),
    dbPath: dbPath(),
    dbAvailable: available,
    dbError: dbError(),
    conversations: c.conversations,
    messages: c.messages,
    memories: c.memories,
    sizeBytes: c.sizeBytes
  }
}

export async function exportData(win: BrowserWindow | null): Promise<DataAction> {
  const date = new Date().toISOString().slice(0, 10)
  const options = {
    title: 'Exportar meus dados',
    defaultPath: `assistente-dados-${date}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const target = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  if (target.canceled || !target.filePath) return { ok: false, canceled: true, message: 'Exportação cancelada.' }
  // A chave de API NUNCA entra na exportação.
  const payload = {
    exportedAt: new Date().toISOString(),
    app: { name: 'assistente-pessoal', version: app.getVersion() },
    settings: getSettings(),
    memories: listMemories(),
    conversations: exportConversations()
  }
  try {
    writeFileSync(target.filePath, JSON.stringify(payload, null, 2), 'utf8')
    return { ok: true, message: `Dados exportados para ${target.filePath}` }
  } catch {
    return { ok: false, message: 'Não foi possível gravar o arquivo.' }
  }
}

export async function deleteHistory(win: BrowserWindow | null): Promise<DataAction> {
  const ok = await confirmDestructive(win, 'Apagar todo o histórico de conversas?', 'Todas as conversas salvas serão removidas. Isso não pode ser desfeito.', 'Apagar histórico')
  if (!ok) return { ok: false, canceled: true, message: 'Nada foi apagado.' }
  deleteAllConversations()
  startNewConversation()
  return { ok: true, message: 'Histórico apagado.' }
}

export async function deleteMemory(win: BrowserWindow | null): Promise<DataAction> {
  const ok = await confirmDestructive(win, 'Apagar toda a memória?', 'Todos os itens que você pediu para o assistente lembrar serão removidos. Isso não pode ser desfeito.', 'Apagar memória')
  if (!ok) return { ok: false, canceled: true, message: 'Nada foi apagado.' }
  deleteAllMemories()
  return { ok: true, message: 'Memória apagada.' }
}

export async function deleteEverything(win: BrowserWindow | null): Promise<DataAction> {
  const ok = await confirmDestructive(
    win,
    'Apagar TODOS os dados do assistente?',
    'Serão removidos: conversas, memória, chave de API e configurações. O aplicativo volta ao estado inicial. Isso não pode ser desfeito.',
    'Apagar tudo'
  )
  if (!ok) return { ok: false, canceled: true, message: 'Nada foi apagado.' }
  deleteAllConversations()
  deleteAllMemories()
  try {
    deleteSecret(GROQ_SECRET)
  } catch {
    // sem chave salva
  }
  const settings = resetSettings()
  applySettingsEffects()
  broadcast('settings:changed', settings)
  aiChanged()
  startNewConversation()
  notifyHistoryChanged()
  notifyMemoryChanged()
  return { ok: true, message: 'Todos os dados foram apagados.' }
}

/** Confirma a mudança de retenção quando ela apagaria conversas existentes. */
export async function confirmRetention(win: BrowserWindow | null, days: number): Promise<boolean> {
  const affected = countOlderThan(days)
  if (days <= 0 || affected === 0) return true
  return confirmDestructive(
    win,
    `Apagar ${affected} ${affected === 1 ? 'conversa antiga' : 'conversas antigas'}?`,
    `Conversas sem atividade há mais de ${days} dias serão removidas agora e nas próximas inicializações. Isso não pode ser desfeito.`,
    'Aplicar e apagar'
  )
}
