/**
 * Texto longo demais para o tempo real de fala indica invenção do reconhecedor
 * (por exemplo, ruído baixo virando "endereços"). Fala normal tem 2 a 3 palavras por
 * segundo e a muito rápida chega perto de 5.
 */
export function plausibleSpeech(text: string, voicedMs: number): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  const seconds = Math.max(voicedMs, 300) / 1000
  if (words > seconds * 5 + 2) return false
  // Endereços de internet saindo de trechos curtos são um artefato clássico.
  if (/\b(https?:\/\/|www\.)\S+/i.test(text) && seconds < 3) return false
  return true
}
