import { randomUUID } from 'node:crypto'
import { createGuard, fetchChecked } from '../providers/http'
import { ProviderError } from '../providers/types'
import type { SpeechToText, TranscribeOptions, TranscriptionResult } from './types'

// Transcrição via Whisper hospedado na Groq (endpoint compatível com OpenAI).
// O áudio é enviado pela internet; nada é gravado em disco.

const DEFAULT_MODEL = 'whisper-large-v3'
const TIMEOUT_MS = 60_000
const EXTENSIONS: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/wav': 'wav' }

export const ALLOWED_AUDIO_TYPES = Object.keys(EXTENSIONS)

export interface GroqWhisperConfig {
  baseUrl: string
  apiKey: string | null
}

/** Monta o corpo multipart/form-data à mão (sem depender de FormData). Os campos de texto são constantes do app. */
function multipart(boundary: string, fields: Record<string, string>, file: { filename: string; type: string; data: Uint8Array }): Buffer {
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`),
    Buffer.from(file.data),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  )
  return Buffer.concat(parts)
}

// Média de avg_logprob abaixo disto indica pouca confiança do modelo (valores típicos de fala clara ficam entre -0,1 e -0,4).
const LOW_CONFIDENCE_LOGPROB = -0.65

interface Segment {
  text?: unknown
  no_speech_prob?: unknown
  avg_logprob?: unknown
  compression_ratio?: unknown
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Um trecho é descartado se parecer silêncio, fala duvidosa ou repetição (sinais clássicos de alucinação). */
function isSpeechSegment(s: Segment): boolean {
  const noSpeech = num(s.no_speech_prob)
  const logprob = num(s.avg_logprob)
  const compression = num(s.compression_ratio)
  if (noSpeech !== null && noSpeech > 0.8) return false
  if (noSpeech !== null && logprob !== null && noSpeech > 0.5 && logprob < -0.8) return false
  if (compression !== null && compression > 2.4) return false
  return true
}

const normalize = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

const KNOWN_ARTIFACTS = new Set([
  'legendas pela comunidade amara org',
  'transcrição e legendas pela comunidade de amara org',
  'legenda adriana zanotto',
  'obrigado por assistir',
  'inscreva se no canal'
])

export class GroqWhisper implements SpeechToText {
  readonly id = 'groq-whisper'
  readonly label = 'Groq Whisper'
  private cfg: GroqWhisperConfig

  constructor(cfg: GroqWhisperConfig) {
    this.cfg = cfg
  }

  async transcribe(audio: Uint8Array, mimeType: string, options: TranscribeOptions): Promise<TranscriptionResult> {
    if (!this.cfg.apiKey) throw new ProviderError('missing_key', 'chave ausente')
    const ext = EXTENSIONS[mimeType]
    if (!ext) throw new ProviderError('bad_request', 'formato de áudio não suportado')

    const boundary = `----assistente${randomUUID()}`
    const prompt = options.prompt?.trim() ?? ''
    // verbose_json devolve, por trecho, a probabilidade de ser silêncio; usamos isso para descartar falsas detecções.
    const fields: Record<string, string> = {
      model: options.model ?? DEFAULT_MODEL,
      language: options.language,
      response_format: 'verbose_json',
      temperature: '0'
    }
    if (prompt) fields.prompt = prompt
    const body = multipart(
      boundary,
      fields,
      { filename: `audio.${ext}`, type: mimeType, data: audio }
    )
    // Cópia para um Uint8Array "puro": é o tipo que o TypeScript aceita como corpo de requisição
    // (o Buffer do Node é rejeitado nas versões recentes dos tipos).
    const payload = new Uint8Array(body.byteLength)
    payload.set(body)
    const guard = createGuard(options.signal, TIMEOUT_MS)
    try {
      const res = await fetchChecked(
        `${this.cfg.baseUrl}/audio/transcriptions`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: payload
        },
        guard
      )
      const json = (await res.json()) as { text?: unknown; segments?: Segment[] }
      const segments = Array.isArray(json.segments) ? json.segments : []
      let text = typeof json.text === 'string' ? json.text.trim() : ''
      let lowConfidence = false

      if (segments.length > 0) {
        // O Whisper às vezes "inventa" frases em silêncio ou ruído. Descartamos os trechos que parecem não ser fala.
        const kept = segments.filter(isSpeechSegment)
        if (kept.length === 0) throw new ProviderError('empty', 'sem fala')
        if (kept.length < segments.length) {
          const joined = kept
            .map((s) => (typeof s.text === 'string' ? s.text : ''))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
          if (joined) text = joined
        }
        const logprobs = kept.map((s) => num(s.avg_logprob)).filter((v): v is number => v !== null)
        if (logprobs.length > 0) {
          lowConfidence = logprobs.reduce((a, b) => a + b, 0) / logprobs.length < LOW_CONFIDENCE_LOGPROB
        }
      }

      if (!text) throw new ProviderError('empty', 'sem texto')
      const normalized = normalize(text)
      // Frases que o Whisper costuma inventar quando não há fala (vêm de legendas de vídeos usados no treino).
      if (KNOWN_ARTIFACTS.has(normalized)) throw new ProviderError('empty', 'artefato conhecido')
      // Com "prompt", o modelo pode devolver o próprio prompt quando não há fala.
      if (prompt && normalized === normalize(prompt)) throw new ProviderError('empty', 'eco do prompt')
      return { text, lowConfidence }
    } finally {
      guard.dispose()
    }
  }
}
