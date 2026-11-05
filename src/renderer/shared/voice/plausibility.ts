const MIN_PLAUSIBLE_VOICED_MS = 300

/**
 * Texto longo demais para o tempo real de fala indica invenção do reconhecedor
 * (por exemplo, ruído baixo virando "endereços"). Fala normal tem 2 a 3 palavras por
 * segundo e a muito rápida chega perto de 5.
 */
export function plausibleSpeech(text: string, voicedMs: number): boolean {
  const normalized = text.trim()
  if (!normalized || voicedMs < MIN_PLAUSIBLE_VOICED_MS) return false
  const words = normalized.split(/\s+/).filter(Boolean).length
  const seconds = Math.max(voicedMs, 300) / 1000
  if (words > seconds * 5 + 2) return false
  // Endereços de internet saindo de trechos curtos são um artefato clássico.
  if (/\b(https?:\/\/|www\.)\S+/i.test(normalized) && seconds < 3) return false
  return true
}
