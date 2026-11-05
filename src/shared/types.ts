
export type Edge = 'left' | 'right'
export type MainPage = 'chat' | 'history' | 'memory' | 'settings' | 'permissions' | 'privacy' | 'diagnostics'

export interface Settings {
  widgetEdge: Edge

  widgetY: number | null
  widgetEnabled: boolean

  shortcut: string

  model: string

  saveHistory: boolean

  retentionDays: number

  useMemory: boolean

  voiceConsent: boolean

  micDeviceId: string

  voiceAutoSend: boolean

  speakReplies: boolean

  ttsVoiceURI: string

  ttsRate: number

  convPauseMs: number

  bargeIn: BargeInMode

  conversationReplies: ReplyLength

  micAutoGain: boolean

  sttModel: SttModel

  sttVocabulary: string

  searchUsage: { month: string; count: number }

  autoSearch: boolean
  sttUseContext: boolean
  toolsEnabled: boolean
  autonomy: 'explicit' | 'ask'
  browserBridge: boolean
}

export interface SendMeta {

  fromVoice?: boolean

  lowConfidence?: boolean

  conversation?: boolean

  search?: boolean
}

export type BargeInMode = 'off' | 'headphones' | 'speakers'
export type ReplyLength = 'short' | 'medium' | 'normal'

export type SttModel = 'whisper-large-v3' | 'whisper-large-v3-turbo'

export type SettingsPatch = Partial<
  Pick<
    Settings,
    | 'widgetEdge'
    | 'widgetEnabled'
    | 'saveHistory'
    | 'retentionDays'
    | 'useMemory'
    | 'voiceConsent'
    | 'micDeviceId'
    | 'voiceAutoSend'
    | 'speakReplies'
    | 'ttsVoiceURI'
    | 'ttsRate'
    | 'convPauseMs'
    | 'micAutoGain'
    | 'bargeIn'
    | 'conversationReplies'
    | 'sttModel'
    | 'sttVocabulary'
    | 'autoSearch'
    | 'sttUseContext'
    | 'toolsEnabled'
    | 'autonomy'
    | 'browserBridge'
  >
>

export type ChatRole = 'user' | 'assistant' | 'notice' | 'error'
export type ChatAction = 'open-settings' | 'open-memory' | 'browser-search' | 'open-permissions'

export interface Source {
  title: string
  url: string
}
export type ChatStatus = 'idle' | 'thinking' | 'streaming'

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  ts: number

  action?: ChatAction

  actionData?: string

  sources?: Source[]
  attachments?: string[]
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  messageCount: number
  current: boolean
}

export interface MemoryItem {
  id: string
  content: string

  always: boolean
  createdAt: number
  updatedAt: number
}

export type MemoryResult = { ok: true; item: MemoryItem; duplicate?: boolean } | { ok: false; error: string }

export interface DataInfo {
  folder: string
  dbPath: string
  dbAvailable: boolean
  dbError: string | null
  conversations: number
  messages: number
  memories: number
  sizeBytes: number
}

export interface DataAction {
  ok: boolean
  canceled?: boolean
  message: string
}

export interface AiConfig {
  providerLabel: string
  model: string
  defaultModel: string
  hasKey: boolean

  secureStorage: boolean
}

export type AiResult = { ok: true; config: AiConfig } | { ok: false; error: string }

export interface ConnectionTest {
  ok: boolean
  message: string
  modelFound?: boolean

  suggestions?: string[]
}

export type VoiceBeginResult = { ok: true } | { ok: false; error: string; action?: 'open-settings' }
export type TranscribeResult =
  | { ok: true; text: string; lowConfidence: boolean }
  | { ok: false; error: string; canceled?: boolean; soft?: boolean; action?: 'open-settings' }

export interface ModelResult {
  model: SttModel
  label: string
  ok: boolean
  text?: string
  error?: string

  ms: number
}
export type CompareResult = { ok: true; results: ModelResult[] } | { ok: false; error: string; action?: 'open-settings' }

export type GrantKind = 'site' | 'site_read' | 'app' | 'folder_read' | 'folder_write' | 'browser_read'

export interface Grant {
  id: string
  kind: GrantKind
  target: string
  label: string
  createdAt: number
}

export interface ToolLogEntry {
  id: number
  ts: number
  tool: string
  target: string
  outcome: 'done' | 'denied' | 'error'
  detail: string
}

export interface AttachmentInfo {
  id: string
  name: string
  kind: 'file' | 'git'
  chars: number
}

export interface AttachResult {
  ok: boolean
  canceled?: boolean
  message: string
}

export interface SearchConfig {
  hasKey: boolean
  secureStorage: boolean
  usedThisMonth: number
  monthlyFree: number
}

export type SearchKeyResult = { ok: true; config: SearchConfig } | { ok: false; error: string }

export interface ProcessMetric {
  type: string
  name?: string
  memoryMB: number
  cpuPercent: number
}

export interface Diagnostics {
  processes: ProcessMetric[]
  totalMemoryMB: number
  appVersion: string
  electron: string
  chrome: string
  node: string
  shortcut: string
  shortcutRegistered: boolean
  userDataPath: string
}

export interface AssistantApi {
  chat: {
    getHistory(): Promise<ChatMessage[]>
    getStatus(): Promise<ChatStatus>
    send(text: string, meta?: SendMeta): Promise<void>
    cancel(): void
    newConversation(): void
    onUpdated(cb: (messages: ChatMessage[]) => void): () => void
    onStatus(cb: (status: ChatStatus) => void): () => void
  }
  history: {
    list(): Promise<ConversationSummary[]>
    open(id: string): Promise<boolean>
    remove(id: string): Promise<DataAction>
    onChanged(cb: () => void): () => void
  }
  memory: {
    list(): Promise<MemoryItem[]>
    add(content: string, always: boolean): Promise<MemoryResult>
    update(id: string, patch: { content?: string; always?: boolean }): Promise<MemoryResult>
    remove(id: string): Promise<void>
    onChanged(cb: () => void): () => void
  }
  data: {
    info(): Promise<DataInfo>
    exportAll(): Promise<DataAction>
    deleteHistory(): Promise<DataAction>
    deleteMemory(): Promise<DataAction>
    deleteEverything(): Promise<DataAction>
  }
  ai: {
    getConfig(): Promise<AiConfig>
    setKey(key: string): Promise<AiResult>
    removeKey(): Promise<AiResult>
    setModel(model: string): Promise<AiResult>
    testConnection(): Promise<ConnectionTest>
    onConfigChanged(cb: (config: AiConfig) => void): () => void
  }
  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
    onChanged(cb: (settings: Settings) => void): () => void
  }
  windows: {
    toggleCompact(): void
    hideCompact(): void
    setCompactPinned(pinned: boolean): void
    openMain(page?: MainPage): void
    quit(): void
    onCompactVisible(cb: (visible: boolean) => void): () => void
    onNavigate(cb: (page: MainPage) => void): () => void
  }
  float: {
    dragStart(pointerScreenY: number): void
    dragMove(pointerScreenY: number): void
    dragEnd(): void
  }
  voice: {

    begin(): Promise<VoiceBeginResult>
    transcribe(audio: ArrayBuffer, mimeType: string): Promise<TranscribeResult>
    cancelTranscription(): void

    compare(audio: ArrayBuffer, mimeType: string): Promise<CompareResult>

    allowMicTest(): Promise<void>
  }
  search: {
    getConfig(): Promise<SearchConfig>
    setKey(key: string): Promise<SearchKeyResult>
    removeKey(): Promise<SearchKeyResult>
    test(): Promise<{ ok: boolean; message: string }>
    openInBrowser(query: string): void
    onConfigChanged(cb: (config: SearchConfig) => void): () => void
  }
  permissions: {
    list(): Promise<Grant[]>
    log(): Promise<ToolLogEntry[]>
    addSite(domain: string, mode: 'open' | 'read'): Promise<AttachResult>
    addApp(): Promise<AttachResult>
    addFolder(mode: 'read' | 'write'): Promise<AttachResult>
    revoke(id: string): Promise<void>
    clearLog(): void
    onChanged(cb: () => void): () => void
    browserInfo(): Promise<{ enabled: boolean; port: number | null; connected: boolean; pairingCode: string | null }>
    regenerateBrowserCode(): Promise<{ pairingCode: string | null }>
  }
  attachments: {
    list(): Promise<AttachmentInfo[]>
    pickFiles(): Promise<AttachResult>
    pickGit(): Promise<AttachResult>
    remove(id: string): Promise<void>
    clear(): Promise<void>
    onChanged(cb: (list: AttachmentInfo[]) => void): () => void
  }
  clipboard: {
    copy(text: string): void
  }
  diagnostics: {
    get(): Promise<Diagnostics>
  }
}
