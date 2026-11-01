import { dialog } from 'electron'
import { GROQ_BASE_URL, GROQ_SECRET } from '../providers'
import { ProviderError, userMessage } from '../providers/types'
import { getSecret } from '../secrets'
import { getSettings, updateSettings } from '../settings'
import { broadcast, setCompactAutoHideSuspended } from '../windows'
import { listAttachments } from '../attachments'
import { getRecentText } from '../chat-store'
import { GroqWhisper } from './groq-whisper'
import type { TranscriptionResult } from './types'
import type { ModelResult, SttModel } from '../../shared/types'

export { ALLOWED_AUDIO_TYPES } from './groq-whisper'

let current: AbortController | null = null
let micTestUntil = 0

const engine = (): GroqWhisper => new GroqWhisper({ baseUrl: GROQ_BASE_URL, apiKey: getSecret(GROQ_SECRET) })
const MODEL_LABELS: Record<SttModel, string> = {
  'whisper-large-v3': 'Whisper large-v3 (mais preciso)',
  'whisper-large-v3-turbo': 'Whisper large-v3-turbo (mais rápido)'
}

export function describeTranscribeError(error: unknown): { canceled?: boolean; soft?: boolean; error: string; action?: 'open-settings' } {
  const err = error instanceof ProviderError ? error : new ProviderError('unknown', 'falha na transcrição')
  if (err.kind === 'cancelled') return { canceled: true, error: '' }
  if (err.kind === 'empty') return { error: 'Não consegui entender o áudio. Tente falar mais perto do microfone.', soft: true }
  return { error: userMessage(err), action: err.kind === 'missing_key' || err.kind === 'invalid_key' ? 'open-settings' : undefined }
}

function transcriptionPrompt(): string {
  const { sttVocabulary, sttUseContext } = getSettings()
  const parts = [sttVocabulary.trim()]
  if (sttUseContext) {
    const names = listAttachments().map((a) => a.name)
    if (names.length > 0) parts.push(names.join(', '))
    const tail = getRecentText(240)
    if (tail) parts.push(tail)
  }
  return parts.filter(Boolean).join('. ').slice(-500)
}

export async function transcribe(audio: Uint8Array, mimeType: string): Promise<TranscriptionResult> {
  current?.abort()
  const ctl = new AbortController()
  current = ctl
  const { sttModel } = getSettings()
  try {
    return await engine().transcribe(audio, mimeType, { signal: ctl.signal, language: 'pt', model: sttModel, prompt: transcriptionPrompt() })
  } finally {
    if (current === ctl) current = null
  }
}

export async function compareModels(audio: Uint8Array, mimeType: string): Promise<ModelResult[]> {
  current?.abort()
  const ctl = new AbortController()
  current = ctl
  const prompt = transcriptionPrompt()
  const run = async (model: SttModel): Promise<ModelResult> => {
    const started = Date.now()
    try {
      const { text } = await engine().transcribe(audio, mimeType, { signal: ctl.signal, language: 'pt', model, prompt })
      return { model, label: MODEL_LABELS[model], ok: true, text, ms: Date.now() - started }
    } catch (error) {
      const d = describeTranscribeError(error)
      return { model, label: MODEL_LABELS[model], ok: false, error: d.canceled ? 'Cancelado.' : d.error, ms: Date.now() - started }
    }
  }
  try {
    return await Promise.all([run('whisper-large-v3'), run('whisper-large-v3-turbo')])
  } finally {
    if (current === ctl) current = null
  }
}

export function allowLocalMicTest(): void {
  micTestUntil = Date.now() + 20_000
}

export const isMicrophoneAllowed = (): boolean => getSettings().voiceConsent || Date.now() < micTestUntil

export function cancelTranscription(): void {
  current?.abort()
}

export async function ensureVoiceConsent(): Promise<boolean> {
  if (getSettings().voiceConsent) return true

  setCompactAutoHideSuspended(true)
  try {
    const answer = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Cancelar', 'Permitir'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Entrada de voz',
      message: 'Enviar o áudio da sua voz à Groq para transcrição?',
      detail:
        'Ao usar o microfone, o áudio gravado é enviado pela internet à Groq (api.groq.com) para virar texto. ' +
        'O microfone só grava enquanto você usa o botão, e o áudio não fica salvo no seu computador. ' +
        'Você pode revogar esta permissão em Configurações. Evite falar dados sensíveis e leia a política de privacidade da Groq.'
    })
    if (answer.response !== 1) return false
  } finally {
    setCompactAutoHideSuspended(false)
  }
  broadcast('settings:changed', updateSettings({ voiceConsent: true }))
  return true
}
