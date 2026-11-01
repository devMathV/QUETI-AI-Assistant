// Contrato do reconhecimento de voz. A interface do app só conhece esta
// definição; trocar o motor (outro serviço, ou um modelo local no futuro)
// significa escrever outra implementação.

export interface TranscribeOptions {
  signal: AbortSignal
  /** Código ISO 639-1 do idioma falado (ex.: "pt"). */
  language: string
  /** Modelo a usar (se omitido, o padrão do motor). */
  model?: string
  /** Texto de apoio (ex.: nomes e termos) para orientar a grafia. */
  prompt?: string
}

export interface TranscriptionResult {
  text: string
  /** O motor indicou baixa confiança nesta transcrição. */
  lowConfidence: boolean
}

export interface SpeechToText {
  readonly id: string
  readonly label: string
  transcribe(audio: Uint8Array, mimeType: string, options: TranscribeOptions): Promise<TranscriptionResult>
}
