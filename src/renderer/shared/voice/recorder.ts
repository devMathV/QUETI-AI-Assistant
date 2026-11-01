// Gravação de voz sob demanda. O microfone só é aberto em start() e é SEMPRE
// liberado (tracks parados) em stop() ou cancel(): não há escuta contínua.

export type VoiceErrorKind = 'denied' | 'no-device' | 'busy' | 'unsupported' | 'unknown'

export class VoiceError extends Error {
  kind: VoiceErrorKind
  constructor(kind: VoiceErrorKind, message: string) {
    super(message)
    this.name = 'VoiceError'
    this.kind = kind
  }
}

export interface Recording {
  data: ArrayBuffer
  mimeType: string
  durationMs: number
  /** Tempo em que houve som de fala (acima do ruído). */
  voicedMs: number
  /** Nível mais alto medido, em dB (0 = máximo digital). */
  peakDb: number
  /** Não houve fala (microfone mudo, desligado ou só ruído): não vale a pena enviar. */
  silent: boolean
}

const METER_INTERVAL_MS = 100
const MIN_VOICED_MS = 300
const MIN_PEAK_DB = -55

const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

export function mapMicError(error: unknown): VoiceError {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new VoiceError(
      'denied',
      'O microfone foi bloqueado. No Windows, abra Configurações → Privacidade e segurança → Microfone e permita que aplicativos para desktop acessem o microfone.'
    )
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return new VoiceError('no-device', 'Nenhum microfone encontrado. Conecte um microfone e tente de novo.')
  }
  if (name === 'NotReadableError') {
    return new VoiceError('busy', 'Não consegui usar o microfone. Ele pode estar em uso por outro programa.')
  }
  return new VoiceError('unknown', 'Não foi possível acessar o microfone.')
}

// Processamento de áudio do próprio sistema: reduz ruído de fundo, eco e oscilações de volume.
// Gravamos em mono, que é o que o reconhecimento de voz usa.
const audioConstraints = (autoGain: boolean) => ({ echoCancellation: true, noiseSuppression: true, autoGainControl: autoGain, channelCount: 1 })

// O controle automático de volume amplifica ruídos baixos em silêncio, o que pode virar palavras inventadas
// na transcrição. Por isso ele é opcional (e o modo conversa o mantém sempre desligado).
export async function openMicrophone(deviceId: string, autoGain = true): Promise<MediaStream> {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...audioConstraints(autoGain), deviceId: { exact: deviceId } } })
    } catch (error) {
      // Microfone escolhido não está mais disponível: usa o padrão do sistema.
      if (!(error instanceof DOMException) || (error.name !== 'OverconstrainedError' && error.name !== 'NotFoundError')) throw error
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: audioConstraints(autoGain) })
}

export class VoiceRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private startedAt = 0
  private maxTimer: number | undefined
  private context: AudioContext | null = null
  private meterTimer: number | undefined
  private levels: number[] = []

  get active(): boolean {
    return this.recorder !== null && this.recorder.state !== 'inactive'
  }

  async start(deviceId: string, maxMs: number, onMaxDuration: () => void, autoGain = true): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new VoiceError('unsupported', 'Este ambiente não suporta gravação de áudio.')
    }
    this.release()
    try {
      this.stream = await openMicrophone(deviceId, autoGain)
    } catch (error) {
      throw mapMicError(error)
    }
    const mimeType = PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined)
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start()
    this.startedAt = Date.now()
    this.startMeter()
    // Limite de segurança: nunca grava indefinidamente (protege também a cota gratuita).
    this.maxTimer = window.setTimeout(onMaxDuration, maxMs)
  }

  /** Para a gravação, libera o microfone e devolve o áudio. */
  stop(): Promise<Recording | null> {
    return new Promise((resolve) => {
      const recorder = this.recorder
      if (!recorder || recorder.state === 'inactive') {
        this.release()
        resolve(null)
        return
      }
      recorder.onstop = () => {
        const durationMs = Date.now() - this.startedAt
        const stats = this.speechStats(durationMs)
        const type = (recorder.mimeType || 'audio/webm').split(';')[0]
        const blob = new Blob(this.chunks, { type })
        this.release()
        if (blob.size === 0) {
          resolve(null)
          return
        }
        void blob.arrayBuffer().then((data) => resolve({ data, mimeType: type, durationMs, ...stats }))
      }
      recorder.stop()
    })
  }

  /** Para e DESCARTA o áudio. */
  cancel(): void {
    if (this.recorder) {
      this.recorder.onstop = null
      try {
        if (this.recorder.state !== 'inactive') this.recorder.stop()
      } catch {
        // já parado
      }
    }
    this.release()
  }

  /** Mede o volume durante a gravação (no próprio computador) para saber se houve fala. */
  private startMeter(): void {
    if (!this.stream) return
    try {
      const context = new AudioContext()
      void context.resume()
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      context.createMediaStreamSource(this.stream).connect(analyser)
      const buffer = new Float32Array(analyser.fftSize)
      this.levels = []
      this.meterTimer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(buffer)
        let sum = 0
        for (const v of buffer) sum += v * v
        this.levels.push(Math.max(-100, 20 * Math.log10(Math.sqrt(sum / buffer.length) || 1e-5)))
      }, METER_INTERVAL_MS)
      this.context = context
    } catch {
      this.context = null // sem medidor, não bloqueamos a gravação
    }
  }

  private speechStats(durationMs: number): { voicedMs: number; peakDb: number; silent: boolean } {
    // Sem medições (medidor indisponível): não bloqueia e considera a gravação inteira como fala.
    if (this.levels.length < 3) return { voicedMs: durationMs, peakDb: 0, silent: false }
    const sorted = [...this.levels].sort((a, b) => a - b)
    const peakDb = Math.round(sorted[sorted.length - 1])
    const noise = sorted[Math.floor(sorted.length * 0.2)]
    // Limite entre ruído e fala: 10 dB acima do ruído de fundo, mas sempre entre -55 e -35 dB.
    // (Limitar o ruído a -45 evita que quem fala o tempo todo seja confundido com silêncio.)
    const threshold = Math.max(Math.min(noise, -45) + 10, -55)
    const voicedMs = this.levels.filter((l) => l > threshold).length * METER_INTERVAL_MS
    return { voicedMs, peakDb, silent: voicedMs < MIN_VOICED_MS || peakDb < MIN_PEAK_DB }
  }

  private release(): void {
    if (this.meterTimer !== undefined) window.clearInterval(this.meterTimer)
    this.meterTimer = undefined
    void this.context?.close()
    this.context = null
    if (this.maxTimer !== undefined) window.clearTimeout(this.maxTimer)
    this.maxTimer = undefined
    this.stream?.getTracks().forEach((t) => t.stop()) // desliga o microfone de verdade
    this.stream = null
    this.recorder = null
    this.chunks = []
  }
}
