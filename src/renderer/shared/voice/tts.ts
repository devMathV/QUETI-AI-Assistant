// Leitura em voz alta com as vozes instaladas no Windows (Web Speech API do
// Chromium). Funciona offline, sem custo e sem enviar texto a ninguém.
// Interface separada do app: trocar o motor significa reescrever só este arquivo.

export interface SpeakOptions {
  voiceURI: string
  rate: number
  onEnd: () => void
}

export type SpeakResult = { ok: true } | { ok: false; error: string }

/** Uma "sessão" de fala recebe texto aos poucos (enquanto a resposta chega) e lê em ordem. */
export interface SpeechSession {
  enqueue(text: string): void
  /** Avisa que não virá mais texto; onDone é chamado quando a fala terminar. */
  end(): void
  stop(): void
}

export interface SessionOptions {
  voiceURI: string
  rate: number
  onDone: () => void
}

export type SessionResult = { ok: true; session: SpeechSession } | { ok: false; error: string }

export const NO_VOICE_MESSAGE =
  'Nenhuma voz em português foi encontrada no Windows. Instale uma em Configurações do Windows → Hora e idioma → Fala.'

export const ttsSupported = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window

let token = 0

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const now = speechSynthesis.getVoices()
  if (now.length > 0) return Promise.resolve(now)
  // As vozes carregam de forma assíncrona na primeira vez.
  return new Promise((resolve) => {
    const done = (): void => {
      speechSynthesis.removeEventListener('voiceschanged', done)
      window.clearTimeout(timer)
      resolve(speechSynthesis.getVoices())
    }
    const timer = window.setTimeout(done, 1500)
    speechSynthesis.addEventListener('voiceschanged', done)
  })
}

/** Vozes em português (pt-BR primeiro). */
export async function listPortugueseVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return []
  const all = await loadVoices()
  return all
    .filter((v) => v.lang.toLowerCase().startsWith('pt'))
    .sort((a, b) => Number(b.lang.toLowerCase() === 'pt-br') - Number(a.lang.toLowerCase() === 'pt-br') || a.name.localeCompare(b.name))
}

/** Remove marcações para a fala não ler símbolos: blocos de código viram um aviso curto. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, ' (bloco de código) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Versão usada na fala em tempo real: além de limpar, remove qualquer marca restante
 * (asteriscos, crases) para que o início do texto não mude quando o resto chegar.
 */
export function speechText(text: string): string {
  return cleanForSpeech(text).replace(/[*`]+/g, '')
}

/** Divide em trechos curtos: alguns motores de voz travam em textos longos. */
export function chunkForSpeech(text: string, max = 220): string[] {
  const sentences = text.split(/(?<=[.!?…])\s+/)
  const chunks: string[] = []
  let current = ''
  for (const s of sentences) {
    if (current && current.length + s.length + 1 > max) {
      chunks.push(current)
      current = s
    } else {
      current = current ? `${current} ${s}` : s
    }
  }
  if (current) chunks.push(current)
  // Frase única maior que o limite: corta em espaços.
  return chunks.flatMap((c) => (c.length <= max * 2 ? [c] : (c.match(new RegExp(`.{1,${max}}(\\s|$)`, 'g')) ?? [c])))
}

/** Pausa a fala sem perder o ponto (usado quando uma interrupção por voz ainda precisa ser confirmada). */
export function pauseSpeaking(): void {
  if (ttsSupported()) speechSynthesis.pause()
}

export function resumeSpeaking(): void {
  if (ttsSupported()) speechSynthesis.resume()
}

export function stopSpeaking(): void {
  token++
  if (ttsSupported()) speechSynthesis.cancel()
}

export async function startSpeechSession(opts: SessionOptions): Promise<SessionResult> {
  if (!ttsSupported()) return { ok: false, error: 'Este ambiente não suporta leitura em voz alta.' }
  const voices = await listPortugueseVoices()
  const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === opts.voiceURI) ?? voices[0]
  // Sem voz em português, ler com voz de outro idioma soaria errado: avisamos em vez de falar.
  if (!voice) return { ok: false, error: NO_VOICE_MESSAGE }

  stopSpeaking() // interrompe qualquer fala anterior
  const mine = token
  let pending = 0
  let ended = false
  let finished = false
  const maybeDone = (): void => {
    if (!finished && mine === token && ended && pending === 0) {
      finished = true
      opts.onDone()
    }
  }

  return {
    ok: true,
    session: {
      enqueue(text: string) {
        if (mine !== token) return
        const clean = speechText(text)
        if (!clean) return
        for (const chunk of chunkForSpeech(clean)) {
          pending++
          const u = new SpeechSynthesisUtterance(chunk)
          u.voice = voice
          u.lang = voice.lang
          u.rate = opts.rate
          const settle = (): void => {
            pending--
            maybeDone()
          }
          u.onend = settle
          u.onerror = settle
          speechSynthesis.speak(u)
        }
      },
      end() {
        ended = true
        maybeDone()
      },
      stop() {
        if (mine === token) stopSpeaking()
      }
    }
  }
}

/** Lê um texto completo de uma vez (botão "Ouvir" e teste de voz). */
export async function speak(text: string, opts: SpeakOptions): Promise<SpeakResult> {
  const r = await startSpeechSession({ voiceURI: opts.voiceURI, rate: opts.rate, onDone: opts.onEnd })
  if (!r.ok) return r
  r.session.enqueue(text)
  r.session.end()
  return { ok: true }
}
