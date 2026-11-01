import { BrowserWindow, app, clipboard, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { aiChanged, aiConfig } from './ai-config'
import { listAttachments, onAttachmentsChanged, pickFiles, pickGit, removeAttachment, clearAttachments } from './attachments'
import { cancelResponse, getStatus, openSavedConversation, sendUserMessage, startNewConversation } from './assistant'
import { getCurrentConversationId, getHistory, onChatChanged, onHistoryChanged } from './chat-store'
import { deleteConversation, listConversations, purgeByRetention } from './history'
import { isShortcutRegistered, quitApp } from './lifecycle'
import { addMemory, deleteMemory, listMemories, onMemoryChanged, updateMemory } from './memory'
import { confirmRetention, dataInfo, deleteEverything, deleteHistory, deleteMemory as deleteAllMemoryData, exportData } from './privacy'
import { GROQ_SECRET, PROVIDER_LABEL, getProvider } from './providers'
import { ProviderError, userMessage } from './providers/types'
import { deleteSecret, hasSecret, setSecret } from './secrets'
import { RETENTION_OPTIONS, getSettings, updateSettings } from './settings'
import { ALLOWED_AUDIO_TYPES, allowLocalMicTest, cancelTranscription, compareModels, describeTranscribeError, ensureVoiceConsent, transcribe } from './voice'
import { applySettingsPatch } from './widget-control'
import { TAVILY_KEY_PATTERN, describeSearchError, notifySearchConfig, removeSearchKey, saveSearchKey, searchConfig, searchWeb } from './web-search'
import {
  broadcast,
  floatDragEnd,
  floatDragMove,
  floatDragStart,
  hideCompact,
  isOurWebContents,
  openMain,
  setCompactPinned,
  toggleCompact
} from './windows'
import type {
  AiResult,
  CompareResult,
  ConnectionTest,
  DataAction,
  Diagnostics,
  MainPage,
  SettingsPatch,
  TranscribeResult,
  VoiceBeginResult
} from '../shared/types'

const PAGES: MainPage[] = ['chat', 'history', 'memory', 'settings', 'privacy', 'diagnostics']
const KEY_PATTERN = /^gsk_[A-Za-z0-9_-]{10,200}$/
const MODEL_PATTERN = /^[\w.\-/:]{1,100}$/
const ID_PATTERN = /^[\w-]{1,64}$/

const MAX_AUDIO_BYTES = 10 * 1024 * 1024
const MIN_AUDIO_BYTES = 1000
const NON_CHAT = /whisper|tts|orpheus|guard|safeguard|embed/i

function trusted(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return isOurWebContents(e.sender) && e.senderFrame === e.sender.mainFrame
}

function assertTrusted(e: IpcMainInvokeEvent): void {
  if (!trusted(e)) throw new Error('Origem não autorizada.')
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const round1 = (n: number): number => Math.round(n * 10) / 10
function toBytes(value: unknown): Uint8Array | null {
  const tag = Object.prototype.toString.call(value)
  if (tag === '[object ArrayBuffer]') return new Uint8Array(value as ArrayBuffer)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return null
}

const windowOf = (e: IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender)

export function registerIpc(): void {
  onChatChanged((messages) => broadcast('chat:updated', messages))
  onHistoryChanged(() => broadcast('history:changed'))
  onMemoryChanged(() => broadcast('memory:changed'))
  onAttachmentsChanged((list) => broadcast('attachments:changed', list))

  ipcMain.handle('chat:getHistory', (e) => {
    assertTrusted(e)
    return getHistory()
  })
  ipcMain.handle('chat:getStatus', (e) => {
    assertTrusted(e)
    return getStatus()
  })
  ipcMain.handle('chat:send', (e, text: unknown, meta: unknown) => {
    assertTrusted(e)
    if (typeof text !== 'string') throw new Error('Mensagem inválida.')
    const clean = text.trim()
    if (clean.length === 0 || clean.length > 8000) throw new Error('Mensagem vazia ou longa demais.')
    const m = typeof meta === 'object' && meta !== null ? (meta as Record<string, unknown>) : {}
    const fromVoice = m.fromVoice === true
    sendUserMessage(clean, { fromVoice, lowConfidence: fromVoice && m.lowConfidence === true, conversation: fromVoice && m.conversation === true, search: m.search === true })
  })
  ipcMain.on('chat:cancel', (e) => trusted(e) && cancelResponse())
  ipcMain.on('chat:new', (e) => trusted(e) && startNewConversation())

  ipcMain.handle('history:list', (e) => {
    assertTrusted(e)
    return listConversations(getCurrentConversationId())
  })
  ipcMain.handle('history:open', (e, id: unknown) => {
    assertTrusted(e)
    return typeof id === 'string' && ID_PATTERN.test(id) && openSavedConversation(id)
  })
  ipcMain.handle('history:remove', async (e, id: unknown): Promise<DataAction> => {
    assertTrusted(e)
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) return { ok: false, message: 'Conversa inválida.' }
    const win = windowOf(e)
    const options = {
      type: 'warning' as const,
      buttons: ['Cancelar', 'Apagar conversa'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Confirmar',
      message: 'Apagar esta conversa?',
      detail: 'Isso não pode ser desfeito.'
    }
    const answer = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (answer.response !== 1) return { ok: false, canceled: true, message: 'Nada foi apagado.' }
    if (id === getCurrentConversationId()) startNewConversation()
    deleteConversation(id)
    broadcast('history:changed')
    return { ok: true, message: 'Conversa apagada.' }
  })

  ipcMain.handle('memory:list', (e) => {
    assertTrusted(e)
    return listMemories()
  })
  ipcMain.handle('memory:add', (e, content: unknown, always: unknown) => {
    assertTrusted(e)
    return addMemory(content, always === true)
  })
  ipcMain.handle('memory:update', (e, id: unknown, patch: unknown) => {
    assertTrusted(e)
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || typeof patch !== 'object' || patch === null) {
      return { ok: false, error: 'Pedido inválido.' }
    }
    return updateMemory(id, patch as { content?: unknown; always?: unknown })
  })
  ipcMain.handle('memory:remove', (e, id: unknown) => {
    assertTrusted(e)
    if (typeof id === 'string' && ID_PATTERN.test(id)) deleteMemory(id)
  })

  ipcMain.handle('data:info', (e) => {
    assertTrusted(e)
    return dataInfo()
  })
  ipcMain.handle('data:export', (e) => {
    assertTrusted(e)
    return exportData(windowOf(e))
  })
  ipcMain.handle('data:deleteHistory', (e) => {
    assertTrusted(e)
    return deleteHistory(windowOf(e))
  })
  ipcMain.handle('data:deleteMemory', (e) => {
    assertTrusted(e)
    return deleteAllMemoryData(windowOf(e))
  })
  ipcMain.handle('data:deleteEverything', (e) => {
    assertTrusted(e)
    return deleteEverything(windowOf(e))
  })

  ipcMain.handle('ai:getConfig', (e) => {
    assertTrusted(e)
    return aiConfig()
  })
  ipcMain.handle('ai:setKey', (e, key: unknown): AiResult => {
    assertTrusted(e)
    if (typeof key !== 'string' || !KEY_PATTERN.test(key.trim())) {
      return { ok: false, error: 'Chave inválida. As chaves da Groq começam com "gsk_" e não têm espaços.' }
    }
    try {
      setSecret(GROQ_SECRET, key.trim())
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Não foi possível salvar a chave.' }
    }
    return aiChanged()
  })
  ipcMain.handle('ai:removeKey', (e): AiResult => {
    assertTrusted(e)
    try {
      deleteSecret(GROQ_SECRET)
    } catch {
      return { ok: false, error: 'Não foi possível remover a chave.' }
    }
    return aiChanged()
  })
  ipcMain.handle('ai:setModel', (e, model: unknown): AiResult => {
    assertTrusted(e)
    if (typeof model !== 'string' || !MODEL_PATTERN.test(model.trim())) {
      return { ok: false, error: 'Nome de modelo inválido.' }
    }
    updateSettings({ model: model.trim() })
    return aiChanged()
  })
  ipcMain.handle('ai:testConnection', async (e): Promise<ConnectionTest> => {
    assertTrusted(e)
    try {
      const models = await getProvider().listModels()
      const model = getSettings().model
      const modelFound = models.includes(model)
      const suggestions = models.filter((m) => !NON_CHAT.test(m)).slice(0, 12)
      return {
        ok: true,
        modelFound,
        suggestions,
        message: modelFound
          ? `Conexão com a ${PROVIDER_LABEL} funcionando. O modelo "${model}" está disponível.`
          : `Conexão funcionando, mas o modelo "${model}" não aparece na lista da ${PROVIDER_LABEL}. Escolha um dos sugeridos.`
      }
    } catch (error) {
      const err = error instanceof ProviderError ? error : new ProviderError('unknown', 'falha ao testar')
      return { ok: false, message: userMessage(err) }
    }
  })

  ipcMain.handle('settings:get', (e) => {
    assertTrusted(e)
    return getSettings()
  })
  ipcMain.handle('settings:update', async (e, patch: unknown) => {
    assertTrusted(e)
    if (typeof patch !== 'object' || patch === null) throw new Error('Configuração inválida.')
    const p = patch as Record<string, unknown>
    const safe: SettingsPatch = {}
    if (p.widgetEdge === 'left' || p.widgetEdge === 'right') safe.widgetEdge = p.widgetEdge
    if (typeof p.widgetEnabled === 'boolean') safe.widgetEnabled = p.widgetEnabled
    if (typeof p.saveHistory === 'boolean') safe.saveHistory = p.saveHistory
    if (typeof p.useMemory === 'boolean') safe.useMemory = p.useMemory

    if (p.voiceConsent === false) safe.voiceConsent = false
    if (typeof p.voiceAutoSend === 'boolean') safe.voiceAutoSend = p.voiceAutoSend
    if (typeof p.speakReplies === 'boolean') safe.speakReplies = p.speakReplies
    if (typeof p.micDeviceId === 'string' && /^[\w\-+/=.:{}@#]{0,200}$/.test(p.micDeviceId)) safe.micDeviceId = p.micDeviceId
    if (typeof p.ttsVoiceURI === 'string' && p.ttsVoiceURI.length <= 200) safe.ttsVoiceURI = p.ttsVoiceURI
    if (typeof p.ttsRate === 'number' && Number.isFinite(p.ttsRate)) safe.ttsRate = p.ttsRate
    if (typeof p.micAutoGain === 'boolean') safe.micAutoGain = p.micAutoGain
    if (typeof p.autoSearch === 'boolean') safe.autoSearch = p.autoSearch
    if (typeof p.sttUseContext === 'boolean') safe.sttUseContext = p.sttUseContext
    if (p.bargeIn === 'off' || p.bargeIn === 'headphones' || p.bargeIn === 'speakers') safe.bargeIn = p.bargeIn
    if (p.conversationReplies === 'short' || p.conversationReplies === 'medium' || p.conversationReplies === 'normal') {
      safe.conversationReplies = p.conversationReplies
    }
    if (typeof p.convPauseMs === 'number' && Number.isFinite(p.convPauseMs)) safe.convPauseMs = p.convPauseMs
    if (p.sttModel === 'whisper-large-v3' || p.sttModel === 'whisper-large-v3-turbo') safe.sttModel = p.sttModel
    if (typeof p.sttVocabulary === 'string') safe.sttVocabulary = p.sttVocabulary
    if (typeof p.retentionDays === 'number' && RETENTION_OPTIONS.includes(p.retentionDays)) {

      if (await confirmRetention(windowOf(e), p.retentionDays)) safe.retentionDays = p.retentionDays
    }
    const next = applySettingsPatch(safe)
    if (safe.retentionDays !== undefined && safe.retentionDays > 0) {
      purgeByRetention()
      broadcast('history:changed')
    }
    return next
  })

  ipcMain.handle('voice:begin', async (e): Promise<VoiceBeginResult> => {
    assertTrusted(e)
    if (!hasSecret(GROQ_SECRET)) {
      return { ok: false, error: 'Para transcrever sua voz falta a chave de API da Groq. Adicione-a nas configurações.', action: 'open-settings' }
    }
    if (!(await ensureVoiceConsent())) return { ok: false, error: 'O envio de áudio não foi autorizado, então o microfone não foi ligado.' }
    return { ok: true }
  })
  ipcMain.handle('voice:transcribe', async (e, audio: unknown, mimeType: unknown): Promise<TranscribeResult> => {
    assertTrusted(e)
    if (!getSettings().voiceConsent) return { ok: false, error: 'O envio de áudio não foi autorizado.' }
    if (typeof mimeType !== 'string' || !ALLOWED_AUDIO_TYPES.includes(mimeType)) return { ok: false, error: 'Formato de áudio não suportado.' }
    const bytes = toBytes(audio)
    if (!bytes || bytes.byteLength < MIN_AUDIO_BYTES || bytes.byteLength > MAX_AUDIO_BYTES) {
      return { ok: false, error: 'Áudio inválido ou grande demais.' }
    }
    try {
      const result = await transcribe(bytes, mimeType)
      return { ok: true, text: result.text, lowConfidence: result.lowConfidence }
    } catch (error) {
      return { ok: false, ...describeTranscribeError(error) }
    }
  })
  ipcMain.handle('voice:compare', async (e, audio: unknown, mimeType: unknown): Promise<CompareResult> => {
    assertTrusted(e)
    if (!hasSecret(GROQ_SECRET)) {
      return { ok: false, error: 'Falta a chave de API da Groq. Adicione-a nas configurações.', action: 'open-settings' }
    }
    if (!getSettings().voiceConsent) return { ok: false, error: 'O envio de áudio não foi autorizado.' }
    if (typeof mimeType !== 'string' || !ALLOWED_AUDIO_TYPES.includes(mimeType)) return { ok: false, error: 'Formato de áudio não suportado.' }
    const bytes = toBytes(audio)
    if (!bytes || bytes.byteLength < MIN_AUDIO_BYTES || bytes.byteLength > MAX_AUDIO_BYTES) {
      return { ok: false, error: 'Áudio inválido ou grande demais.' }
    }
    return { ok: true, results: await compareModels(bytes, mimeType) }
  })
  ipcMain.handle('voice:allowMicTest', (e) => {
    assertTrusted(e)
    allowLocalMicTest()
  })
  ipcMain.on('voice:cancel', (e) => trusted(e) && cancelTranscription())

  ipcMain.handle('search:getConfig', (e) => {
    assertTrusted(e)
    return searchConfig()
  })
  ipcMain.handle('search:setKey', (e, key: unknown) => {
    assertTrusted(e)
    if (typeof key !== 'string' || !TAVILY_KEY_PATTERN.test(key.trim())) {
      return { ok: false as const, error: 'Chave inválida. As chaves do Tavily começam com "tvly-" e não têm espaços.' }
    }
    try {
      saveSearchKey(key.trim())
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : 'Não foi possível salvar a chave.' }
    }
    return { ok: true as const, config: notifySearchConfig() }
  })
  ipcMain.handle('search:removeKey', (e) => {
    assertTrusted(e)
    try {
      removeSearchKey()
    } catch {
      return { ok: false as const, error: 'Não foi possível remover a chave.' }
    }
    return { ok: true as const, config: notifySearchConfig() }
  })
  ipcMain.handle('search:test', async (e) => {
    assertTrusted(e)
    try {
      const results = await searchWeb('teste de conexão', new AbortController().signal)
      return { ok: true, message: `Conexão funcionando (${results.length} resultados). Esta verificação usou 1 crédito.` }
    } catch (error) {
      return { ok: false, message: describeSearchError(error) }
    }
  })
  ipcMain.on('search:openBrowser', (e, query: unknown) => {
    if (trusted(e) && typeof query === 'string' && query.trim() && query.length <= 400) {
      void shell.openExternal(`https://duckduckgo.com/?q=${encodeURIComponent(query.trim())}`)
    }
  })

  ipcMain.handle('attachments:list', (e) => {
    assertTrusted(e)
    return listAttachments()
  })
  ipcMain.handle('attachments:pickFiles', (e) => {
    assertTrusted(e)
    return pickFiles(windowOf(e))
  })
  ipcMain.handle('attachments:pickGit', (e) => {
    assertTrusted(e)
    return pickGit(windowOf(e))
  })
  ipcMain.on('attachments:remove', (e, id: unknown) => {
    if (trusted(e) && typeof id === 'string' && ID_PATTERN.test(id)) removeAttachment(id)
  })
  ipcMain.on('attachments:clear', (e) => trusted(e) && clearAttachments())

  ipcMain.on('windows:toggleCompact', (e) => trusted(e) && toggleCompact())
  ipcMain.on('windows:hideCompact', (e) => trusted(e) && hideCompact())
  ipcMain.on('windows:setCompactPinned', (e, pinned: unknown) => {
    if (trusted(e) && typeof pinned === 'boolean') setCompactPinned(pinned)
  })
  ipcMain.on('windows:openMain', (e, page: unknown) => {
    if (!trusted(e)) return
    openMain(PAGES.includes(page as MainPage) ? (page as MainPage) : undefined)
  })
  ipcMain.on('app:quit', (e) => trusted(e) && quitApp())

  ipcMain.on('float:dragStart', (e, y: unknown) => trusted(e) && isFiniteNumber(y) && floatDragStart(y))
  ipcMain.on('float:dragMove', (e, y: unknown) => trusted(e) && isFiniteNumber(y) && floatDragMove(y))
  ipcMain.on('float:dragEnd', (e) => trusted(e) && floatDragEnd())

  ipcMain.on('clipboard:write', (e, text: unknown) => {
    if (trusted(e) && typeof text === 'string' && text.length <= 200_000) clipboard.writeText(text)
  })

  ipcMain.handle('diagnostics:get', (e): Diagnostics => {
    assertTrusted(e)
    const processes = app.getAppMetrics().map((m) => ({
      type: m.type,
      name: m.name,

      memoryMB: round1(m.memory.workingSetSize / 1024),
      cpuPercent: round1(m.cpu.percentCPUUsage)
    }))
    return {
      processes,
      totalMemoryMB: round1(processes.reduce((sum, p) => sum + p.memoryMB, 0)),
      appVersion: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      shortcut: getSettings().shortcut,
      shortcutRegistered: isShortcutRegistered(),
      userDataPath: app.getPath('userData')
    }
  })
}
