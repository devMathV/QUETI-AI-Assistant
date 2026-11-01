import type { BargeInMode } from '../../../shared/types'
import { mapMicError, openMicrophone } from './recorder'

// Escuta para o "modo conversa". Detecta quando você começa e quando para de falar
// (detector por volume que se adapta ao ruído do ambiente) e entrega cada frase como WAV.
//
// Privacidade e recursos:
//  - só existe enquanto a sessão estiver ativa (iniciada por clique);
//  - o áudio de silêncio e de ruído NUNCA sai daqui: só frases detectadas são entregues;
//  - enquanto o assistente pensa ou fala, a captura é suspensa (as faixas do microfone são desativadas).

// monitoring: o assistente está respondendo; o microfone escuta só para detectar uma interrupção.
export type ListenState = 'calibrating' | 'listening' | 'hearing' | 'monitoring' | 'paused'

export interface Utterance {
  wav: ArrayBuffer
  durationMs: number
  voicedMs: number
  peakDb: number
  /** A frase começou durante a fala do assistente (interrupção a confirmar). */
  bargeIn: boolean
}

export interface ListenerOptions {
  deviceId: string
  /** Silêncio (ms) que indica o fim da frase. */
  pauseMs: number
  onState: (state: ListenState) => void
  onUtterance: (utterance: Utterance) => void
  /** Interrupção por voz (lido a cada quadro, então a mudança vale na hora). */
  getBargeIn: () => BargeInMode
  /** Voz forte e sustentada detectada enquanto o assistente responde. */
  onBargeIn: () => void
  /** Chamado quando passa muito tempo sem ninguém falar. */
  onIdleTimeout: () => void
}

const SAMPLE_RATE = 16_000
const FRAME = 1024 // ≈ 64 ms
const FRAME_MS = (FRAME / SAMPLE_RATE) * 1000
const CALIBRATION_FRAMES = 13 // ≈ 0,8 s
const START_FRAMES = 2 // ≈ 128 ms acima do limite para considerar que começou uma fala
const PREROLL_FRAMES = 5 // ≈ 320 ms guardados antes do início, para não cortar a primeira sílaba
const TRAILING_FRAMES = 5 // silêncio final mantido na frase
const MIN_VOICED_MS = 400
const MAX_UTTERANCE_MS = 30_000
const IDLE_TIMEOUT_MS = 90_000
const MAX_NOISE_DB = -45
const RING_FRAMES = 24 // ≈ 1,5 s guardados durante o monitoramento (cobre o início da interrupção)
const RECENT_FRAMES = 47 // ≈ 3 s para estimar o nível do eco
const ECHO_WARMUP_MS = 1000 // ao começar a falar, o app só aprende o nível do eco
const SUSTAIN_SPEAKERS_MS = 600
const SUSTAIN_HEADPHONES_MS = 450
const DEFAULT_USER_DB = -35

const rmsDb = (data: Float32Array): number => {
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  return Math.max(-100, 20 * Math.log10(Math.sqrt(sum / data.length) || 1e-5))
}

function encodeWav(frames: Float32Array[]): ArrayBuffer {
  const samples = frames.reduce((n, f) => n + f.length, 0)
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const text = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples * 2, true)
  let offset = 44
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i++) {
      const v = Math.max(-1, Math.min(1, frame[i]))
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true)
      offset += 2
    }
  }
  return buffer
}

export class ConversationListener {
  private opts!: ListenerOptions
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null

  private state: ListenState = 'calibrating'
  private noiseDb = -60
  private calibration: number[] = []
  private preroll: Float32Array[] = []
  private utterance: Float32Array[] = []
  private above = 0
  private voicedMs = 0
  private silentFrames = 0
  private silentMs = 0
  private utteranceMs = 0
  private peakDb = -100
  private lastActivity = Date.now()

  // Interrupção por voz
  private ring: Float32Array[] = []
  private recent: number[] = []
  private assistantSpeaking = false
  private speakStartedAt = 0
  private userMeanDb: number | null = null // volume típico da sua voz (aprendido nas frases anteriores)
  private voicedSum = 0
  private voicedCount = 0
  private score = 0
  private interrupting = false

  async start(opts: ListenerOptions): Promise<void> {
    this.opts = opts
    try {
      this.stream = await openMicrophone(opts.deviceId, false) // sem ganho automático: ele amplifica ruído em silêncio
    } catch (error) {
      throw mapMicError(error)
    }
    // O contexto a 16 kHz faz o navegador reamostrar o microfone: é o que o reconhecimento de voz usa.
    this.context = new AudioContext({ sampleRate: SAMPLE_RATE })
    void this.context.resume()
    this.source = this.context.createMediaStreamSource(this.stream)
    this.processor = this.context.createScriptProcessor(FRAME, 1, 1)
    this.processor.onaudioprocess = (e) => this.onFrame(new Float32Array(e.inputBuffer.getChannelData(0)))
    this.source.connect(this.processor)
    this.processor.connect(this.context.destination) // sem isto o processador não roda; a saída é silenciosa
    this.lastActivity = Date.now()
    this.setState('calibrating')
  }

  private setState(next: ListenState): void {
    if (this.state === next) return
    this.state = next
    this.opts.onState(next)
  }

  private setTracks(enabled: boolean): void {
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = enabled))
  }

  private get onThreshold(): number {
    return Math.max(this.noiseDb + 12, -50)
  }
  private get offThreshold(): number {
    return Math.max(this.noiseDb + 8, -54)
  }

  private resetUtterance(): void {
    this.utterance = []
    this.above = 0
    this.voicedMs = 0
    this.silentFrames = 0
    this.silentMs = 0
    this.utteranceMs = 0
    this.peakDb = -100
    this.voicedSum = 0
    this.voicedCount = 0
  }

  private onFrame(frame: Float32Array): void {
    if (this.state === 'paused') return
    const db = rmsDb(frame)

    if (this.state === 'monitoring') {
      this.monitorFrame(frame, db)
      return
    }

    if (this.state === 'calibrating') {
      this.calibration.push(db)
      if (this.calibration.length >= CALIBRATION_FRAMES) {
        // Percentil 25 (e teto de -45 dB): se você já estiver falando durante o ajuste, a fala não vira "ruído".
        const sorted = [...this.calibration].sort((a, b) => a - b)
        this.noiseDb = Math.min(sorted[Math.floor(sorted.length * 0.25)], MAX_NOISE_DB)
        this.calibration = []
        this.lastActivity = Date.now()
        this.setState('listening')
      }
      return
    }

    if (this.state === 'listening') {
      this.preroll.push(frame)
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift()
      if (db > this.onThreshold) {
        this.above++
        this.peakDb = Math.max(this.peakDb, db)
        if (this.above >= START_FRAMES) {
          this.utterance = [...this.preroll]
          this.voicedMs = this.above * FRAME_MS
          this.utteranceMs = this.utterance.length * FRAME_MS
          this.silentFrames = 0
          this.silentMs = 0
          this.lastActivity = Date.now()
          this.setState('hearing')
        }
      } else {
        this.above = 0
        this.peakDb = -100
        // O ruído de fundo acompanha o ambiente aos poucos (sem deixar a fala entrar na estimativa).
        this.noiseDb = Math.min(this.noiseDb * 0.98 + db * 0.02, MAX_NOISE_DB)
        if (Date.now() - this.lastActivity > IDLE_TIMEOUT_MS) this.opts.onIdleTimeout()
      }
      return
    }

    // hearing
    this.utterance.push(frame)
    this.utteranceMs += FRAME_MS
    this.peakDb = Math.max(this.peakDb, db)
    if (db > this.offThreshold) {
      this.voicedMs += FRAME_MS
      this.voicedSum += db
      this.voicedCount++
      this.silentFrames = 0
      this.silentMs = 0
    } else {
      this.silentFrames++
      this.silentMs += FRAME_MS
    }
    if (this.silentMs >= this.opts.pauseMs || this.utteranceMs >= MAX_UTTERANCE_MS) this.finishUtterance()
  }

  private finishUtterance(): void {
    // Mantém só um pouco do silêncio final.
    const drop = Math.max(0, this.silentFrames - TRAILING_FRAMES)
    const frames = drop > 0 ? this.utterance.slice(0, this.utterance.length - drop) : this.utterance
    const voicedMs = this.voicedMs
    const peakDb = Math.round(this.peakDb)
    const durationMs = frames.length * FRAME_MS
    const bargeIn = this.interrupting
    // Aprende o volume típico da sua voz (só com frases normais: as interrupções têm eco misturado).
    if (!bargeIn && this.voicedCount > 0) {
      const mean = this.voicedSum / this.voicedCount
      this.userMeanDb = this.userMeanDb === null ? mean : this.userMeanDb * 0.6 + mean * 0.4
    }
    this.interrupting = false
    this.resetUtterance()
    this.preroll = []
    if (!bargeIn && voicedMs < MIN_VOICED_MS) {
      // Estalo ou ruído curto: ignora e continua ouvindo.
      this.setState('listening')
      return
    }
    this.setState('paused')
    this.setTracks(false)
    this.opts.onUtterance({ wav: encodeWav(frames), durationMs, voicedMs, peakDb, bargeIn })
  }

  getState(): ListenState {
    return this.state
  }

  /** O app informa quando o assistente começa/termina de falar (para estimar o eco). */
  setAssistantSpeaking(speaking: boolean): void {
    if (speaking && !this.assistantSpeaking) {
      this.speakStartedAt = Date.now()
      this.recent = []
      this.score = 0
    }
    this.assistantSpeaking = speaking
  }

  /** Enquanto o assistente responde: o microfone escuta só para detectar uma interrupção. */
  monitor(): void {
    this.resetUtterance()
    this.preroll = []
    this.ring = []
    this.recent = []
    this.score = 0
    this.interrupting = false
    this.setTracks(true)
    this.setState('monitoring')
  }

  /**
   * Interrupção: sua voz precisa superar (1) o ambiente, (2) o eco do próprio assistente nos alto-falantes
   * e (3) o seu volume típico, e se manter assim por algum tempo. Isso filtra vozes de fundo e estalos.
   */
  private monitorFrame(frame: Float32Array, db: number): void {
    this.ring.push(frame)
    if (this.ring.length > RING_FRAMES) this.ring.shift()
    this.recent.push(db)
    if (this.recent.length > RECENT_FRAMES) this.recent.shift()

    const mode = this.opts.getBargeIn()
    if (mode === 'off') return
    if (this.assistantSpeaking && Date.now() - this.speakStartedAt < ECHO_WARMUP_MS) return

    const sorted = [...this.recent].sort((a, b) => a - b)
    const echoPeak = sorted[Math.floor(sorted.length * 0.9)]
    const base = mode === 'speakers' && this.assistantSpeaking ? echoPeak + 10 : this.noiseDb + 12
    const ownVoice = (this.userMeanDb ?? DEFAULT_USER_DB) - 8
    const threshold = Math.max(base, ownVoice, -50)

    this.score = db > threshold ? this.score + 1 : Math.max(0, this.score - 1)
    const needMs = mode === 'speakers' ? SUSTAIN_SPEAKERS_MS : SUSTAIN_HEADPHONES_MS
    if (this.score * FRAME_MS < needMs) return

    this.interrupting = true
    this.utterance = [...this.ring]
    this.utteranceMs = this.utterance.length * FRAME_MS
    this.voicedMs = this.score * FRAME_MS
    this.silentFrames = 0
    this.silentMs = 0
    this.peakDb = Math.max(...this.recent.slice(-12))
    this.voicedSum = 0
    this.voicedCount = 0
    this.score = 0
    this.lastActivity = Date.now()
    this.setState('hearing')
    this.opts.onBargeIn()
  }

  /** Suspende a captura (o microfone é silenciado) enquanto o assistente processa e fala. */
  pause(): void {
    this.setTracks(false)
    this.resetUtterance()
    this.preroll = []
    this.setState('paused')
  }

  resume(): void {
    this.resetUtterance()
    this.preroll = []
    this.lastActivity = Date.now()
    this.setTracks(true)
    this.setState('listening')
  }

  stop(): void {
    if (this.processor) this.processor.onaudioprocess = null
    this.processor?.disconnect()
    this.source?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop()) // desliga o microfone de verdade
    void this.context?.close()
    this.processor = null
    this.source = null
    this.context = null
    this.stream = null
    this.resetUtterance()
    this.preroll = []
  }
}
