import { useEffect, useRef, useState } from 'react'
import type { Settings } from '../../shared/types'
import { startSpeechSession, stopSpeaking, ttsSupported, type SpeechSession } from './voice/tts'

/** Leitura em voz alta de mensagens: uma de cada vez, com opção de parar. */
export function useSpeech(settings: Settings | null) {
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<SpeechSession | null>(null)

  // Ao fechar a janela/tela, a fala é interrompida.
  useEffect(() => () => stopSpeaking(), [])

  function stop() {
    sessionRef.current?.stop()
    sessionRef.current = null
    stopSpeaking()
    setSpeakingId(null)
  }

  /** Abre uma sessão de fala para a mensagem `id`; o texto é entregue depois, aos poucos. */
  async function begin(id: string, onDone?: () => void): Promise<SpeechSession | null> {
    setError(null)
    const result = await startSpeechSession({
      voiceURI: settings?.ttsVoiceURI ?? '',
      rate: settings?.ttsRate ?? 1,
      onDone: () => {
        setSpeakingId((current) => (current === id ? null : current))
        sessionRef.current = null
        onDone?.()
      }
    })
    if (!result.ok) {
      setError(result.error)
      return null
    }
    sessionRef.current = result.session
    setSpeakingId(id)
    return result.session
  }

  async function speak(id: string, text: string) {
    if (speakingId === id) return stop() // clicar de novo para
    const session = await begin(id)
    if (!session) return
    session.enqueue(text)
    session.end()
  }

  return { supported: ttsSupported(), speakingId, error, speak, begin, stop }
}
