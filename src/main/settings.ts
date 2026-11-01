import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Settings } from '../shared/types'

export const DEFAULT_MODEL = 'openai/gpt-oss-20b'
export const RETENTION_OPTIONS = [0, 30, 90, 365]

const DEFAULTS: Settings = {
  widgetEdge: 'left',
  widgetY: null,
  widgetEnabled: true,

  shortcut: 'CommandOrControl+Shift+Space',
  model: DEFAULT_MODEL,
  saveHistory: true,
  retentionDays: 0,
  useMemory: true,
  voiceConsent: false,
  micDeviceId: '',
  voiceAutoSend: false,
  speakReplies: false,
  ttsVoiceURI: '',
  ttsRate: 1,
  convPauseMs: 1200,
  micAutoGain: true,
  bargeIn: 'speakers',
  conversationReplies: 'short',
  sttModel: 'whisper-large-v3',
  sttVocabulary: '',
  searchUsage: { month: '', count: 0 },
  autoSearch: true,
  sttUseContext: true
}

let cache: Settings | null = null

const filePath = (): string => join(app.getPath('userData'), 'settings.json')

function sanitizeUsage(raw: unknown): { month: string; count: number } {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const month = typeof r.month === 'string' && /^\d{4}-\d{2}$/.test(r.month) ? r.month : ''
  const count = typeof r.count === 'number' && Number.isFinite(r.count) && r.count >= 0 ? Math.floor(r.count) : 0
  return { month, count }
}

function sanitize(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
  return {
    widgetEdge: r.widgetEdge === 'right' ? 'right' : 'left',
    widgetY: typeof r.widgetY === 'number' && Number.isFinite(r.widgetY) ? Math.round(r.widgetY) : null,
    widgetEnabled: bool(r.widgetEnabled, DEFAULTS.widgetEnabled),
    shortcut:
      typeof r.shortcut === 'string' && r.shortcut.length > 0 && r.shortcut.length < 64 ? r.shortcut : DEFAULTS.shortcut,
    model: typeof r.model === 'string' && /^[\w.\-/:]{1,100}$/.test(r.model) ? r.model : DEFAULTS.model,
    saveHistory: bool(r.saveHistory, DEFAULTS.saveHistory),
    retentionDays:
      typeof r.retentionDays === 'number' && RETENTION_OPTIONS.includes(r.retentionDays) ? r.retentionDays : DEFAULTS.retentionDays,
    useMemory: bool(r.useMemory, DEFAULTS.useMemory),
    voiceConsent: bool(r.voiceConsent, DEFAULTS.voiceConsent),
    micDeviceId: typeof r.micDeviceId === 'string' && /^[\w\-+/=.:{}@#]{0,200}$/.test(r.micDeviceId) ? r.micDeviceId : '',
    voiceAutoSend: bool(r.voiceAutoSend, DEFAULTS.voiceAutoSend),
    speakReplies: bool(r.speakReplies, DEFAULTS.speakReplies),
    ttsVoiceURI: typeof r.ttsVoiceURI === 'string' && r.ttsVoiceURI.length <= 200 ? r.ttsVoiceURI : '',
    ttsRate:
      typeof r.ttsRate === 'number' && Number.isFinite(r.ttsRate) ? Math.min(2, Math.max(0.5, Math.round(r.ttsRate * 10) / 10)) : 1,
    convPauseMs:
      typeof r.convPauseMs === 'number' && Number.isFinite(r.convPauseMs) ? Math.min(2500, Math.max(600, Math.round(r.convPauseMs / 100) * 100)) : 1200,
    micAutoGain: bool(r.micAutoGain, DEFAULTS.micAutoGain),
    bargeIn: r.bargeIn === 'off' || r.bargeIn === 'headphones' ? r.bargeIn : 'speakers',
    conversationReplies: r.conversationReplies === 'medium' || r.conversationReplies === 'normal' ? r.conversationReplies : 'short',
    sttModel: r.sttModel === 'whisper-large-v3-turbo' ? 'whisper-large-v3-turbo' : 'whisper-large-v3',
    sttVocabulary: typeof r.sttVocabulary === 'string' ? r.sttVocabulary.replace(/[\x00-\x1f]+/g, ' ').trim().slice(0, 400) : '',
    searchUsage: sanitizeUsage(r.searchUsage),
    autoSearch: bool(r.autoSearch, DEFAULTS.autoSearch),
    sttUseContext: bool(r.sttUseContext, DEFAULTS.sttUseContext)
  }
}

export function getSettings(): Settings {
  if (cache) return cache
  try {
    cache = sanitize(JSON.parse(readFileSync(filePath(), 'utf8')))
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

function save(): void {
  try {
    mkdirSync(dirname(filePath()), { recursive: true })

    const tmp = `${filePath()}.tmp`
    writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8')
    renameSync(tmp, filePath())
  } catch (error) {
    console.error('Falha ao salvar as configurações:', error)
  }
}

export function updateSettings(patch: Partial<Settings>): Settings {
  cache = sanitize({ ...getSettings(), ...patch })
  save()
  return cache
}

export function resetSettings(): Settings {
  cache = { ...DEFAULTS }
  save()
  return cache
}
