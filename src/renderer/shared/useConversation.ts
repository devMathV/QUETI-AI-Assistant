import { useEffect, useRef, useState } from 'react'
import type { Settings } from '../../shared/types'
import { ConversationListener, type ListenState, type Utterance } from './voice/conversation'
import { plausibleSpeech } from './voice/plausibility'
import { VoiceError } from './voice/recorder'

export type ConversationPhase = 'off' | 'starting' | 'calibrating' | 'listening' | 'hearing' | 'transcribing' | 'answering'

const SESSION_MAX_MS = 20 * 60_000
const STOP_WORDS = new Set(['pare', 'para', 'parar', 'chega', 'silencio', 'espera', 'espere', 'calma', 'cala'])

/** Frases curtas como "pare" só interrompem: não vale gastar uma resposta da IA. */
function isStopCommand(text: string): boolean {
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z]+/)
    .filter(Boolean)
  return words.length > 0 && words.length <= 3 && STOP_WORDS.has(words[0])
}

interface Controls {
  /** Pausa a fala sem perder o ponto (a interrupção ainda precisa ser confirmada). */
  pauseSpeech: () => void
  resumeSpeech: () => void
  /** Para a fala e cancela a geração da resposta. */
  abortReply: () => void
}

interface Deps {
  settings: Settings | null
  /** Envia o texto como mensagem de voz e só resolve quando a resposta terminar de ser falada. */
  sendAndWait: (text: string) => Promise<boolean>
  /** Fala uma frase curta local (sem chamar a IA). */
  sayLocal: (text: string) => Promise<void>
  /** O assistente está falando agora (usado para estimar o eco nos alto-falantes). */
  assistantSpeaking: boolean
  controls: Controls
}

/**
 * Conversa por voz: ouve, espera a pausa, transcreve, envia, fala a resposta e volta a ouvir.
 * Enquanto o assistente responde, o microfone só escuta para detectar uma interrupção (se ativada).
 */
export function useConversation(deps: Deps) {
  const [phase, setPhaseRaw] = useState<ConversationPhase>('off')
  const [notice, setNotice] = useState<string | null>(null)
  const listener = useRef<ConversationListener | null>(null)
  const phaseRef = useRef<ConversationPhase>('off')
  const sessionTimer = useRef<number | undefined>(undefined)
  const turn = useRef(0)
  const turnActive = useRef(false) // há uma resposta em andamento (sendo gerada ou falada)
  const bargeInBusy = useRef(false) // uma interrupção está sendo avaliada
  const latest = useRef(deps)
  latest.current = deps

  // Lê o valor atual sem que o TypeScript "memorize" uma comparação anterior (o valor muda durante os await).
  const isOff = (): boolean => phaseRef.current === 'off'

  function setPhase(next: ConversationPhase) {
    phaseRef.current = next
    setPhaseRaw(next)
  }

  function end(message?: string) {
    window.clearTimeout(sessionTimer.current)
    listener.current?.stop()
    listener.current = null
    window.api.voice.cancelTranscription()
    latest.current.controls.resumeSpeech() // não deixa a fala "pausada" para sempre
    turnActive.current = false
    bargeInBusy.current = false
    setPhase('off')
    setNotice(message ?? null)
  }

  function onState(state: ListenState) {
    if (isOff() || phaseRef.current === 'transcribing' || phaseRef.current === 'answering') return
    if (state === 'calibrating') setPhase('calibrating')
    else if (state === 'listening') setPhase('listening')
    else if (state === 'hearing') setPhase('hearing')
  }

  // Enquanto responde: microfone só monitorando interrupção (ou silenciado, se desativada).
  function startAnswering() {
    if (latest.current.settings?.bargeIn === 'off') listener.current?.pause()
    else listener.current?.monitor()
  }

  function backToListening() {
    if (isOff()) return
    setPhase('listening')
    listener.current?.resume()
  }

  /** Envia o que foi dito e acompanha a resposta até ela terminar de ser falada. */
  async function runTurn(text: string) {
    setNotice(null)
    setPhase('answering')
    startAnswering()
    const mine = ++turn.current
    turnActive.current = true
    const ok = await latest.current.sendAndWait(text)
    if (isOff() || mine !== turn.current) return // sessão encerrada ou resposta interrompida
    turnActive.current = false
    if (bargeInBusy.current) return // uma interrupção está sendo avaliada: ela decide o que fazer
    if (!ok) return end('Não foi possível enviar a mensagem. A conversa por voz foi encerrada.')
    backToListening()
  }

  async function onUtterance(u: Utterance) {
    if (u.bargeIn) return handleBargeIn(u)
    setPhase('transcribing')
    const result = await window.api.voice.transcribe(u.wav, 'audio/wav')
    if (isOff()) return

    if (!result.ok) {
      if (result.canceled) return
      if (result.soft) {
        setNotice('Não consegui entender essa parte. Pode repetir?')
        return backToListening()
      }
      // Erro de verdade (chave, limite de uso, rede): encerra para não ficar tentando em loop.
      return end(result.error)
    }
    if (!plausibleSpeech(result.text, u.voicedMs)) {
      setNotice('Descartei um trecho que parecia ruído, não fala.')
      return backToListening()
    }
    if (result.lowConfidence) {
      // Pouca confiança: não envia à IA. Pede para repetir (barato e evita agir sobre algo mal entendido).
      setNotice(`Não entendi bem: “${result.text}”. Pode repetir?`)
      setPhase('answering')
      await latest.current.sayLocal('Não entendi bem. Pode repetir?')
      return backToListening()
    }
    await runTurn(result.text)
  }

  /** Alguém falou por cima do assistente (a fala já foi pausada): confirma se era mesmo você. */
  async function handleBargeIn(u: Utterance) {
    const { controls } = latest.current
    // Falso alarme: volta a falar de onde parou e continua monitorando.
    const keepSpeaking = () => {
      bargeInBusy.current = false
      if (!turnActive.current) return backToListening() // a resposta já havia terminado
      setPhase('answering')
      controls.resumeSpeech()
      listener.current?.monitor()
    }

    if (u.voicedMs < 400) return keepSpeaking()
    setPhase('transcribing')
    const result = await window.api.voice.transcribe(u.wav, 'audio/wav')
    if (isOff()) return
    if (!result.ok && !result.soft && !result.canceled) return end(result.error)
    if (!result.ok || result.lowConfidence || !plausibleSpeech(result.text, u.voicedMs)) return keepSpeaking()

    // Interrupção confirmada: para a fala, cancela a resposta e trata o que você disse.
    turn.current++
    turnActive.current = false
    bargeInBusy.current = false
    controls.abortReply()
    if (isStopCommand(result.text)) {
      setNotice('Parei. Pode falar.')
      return backToListening()
    }
    await runTurn(result.text)
  }

  /** Botão "Interromper": para o assistente na hora e volta a ouvir. */
  function interruptNow() {
    if (isOff()) return
    turn.current++
    turnActive.current = false
    bargeInBusy.current = false
    latest.current.controls.abortReply()
    backToListening()
  }

  // Informa ao detector quando o assistente está falando (para aprender o nível do eco).
  useEffect(() => {
    listener.current?.setAssistantSpeaking(deps.assistantSpeaking)
  }, [deps.assistantSpeaking])

  async function start() {
    if (!isOff()) return
    setNotice(null)
    setPhase('starting')
    const begin = await window.api.voice.begin()
    if (!begin.ok) {
      setPhase('off')
      setNotice(begin.error)
      return
    }
    if (document.hidden) return setPhase('off')
    const l = new ConversationListener()
    listener.current = l
    try {
      await l.start({
        deviceId: latest.current.settings?.micDeviceId ?? '',
        pauseMs: latest.current.settings?.convPauseMs ?? 1200,
        onState,
        onUtterance: (u) => void onUtterance(u),
        getBargeIn: () => latest.current.settings?.bargeIn ?? 'speakers',
        onBargeIn: () => {
          bargeInBusy.current = true
          latest.current.controls.pauseSpeech()
          setPhase('hearing')
        },
        onIdleTimeout: () => end('Conversa por voz encerrada: ninguém falou por um tempo.')
      })
    } catch (e) {
      listener.current = null
      setPhase('off')
      setNotice(e instanceof VoiceError ? e.message : 'Não foi possível acessar o microfone.')
      return
    }
    setPhase('calibrating')
    sessionTimer.current = window.setTimeout(() => end('Conversa por voz encerrada: tempo máximo da sessão (20 minutos).'), SESSION_MAX_MS)
  }

  // Segurança: ocultar ou minimizar a janela encerra a sessão e desliga o microfone.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && !isOff()) end('Conversa por voz encerrada porque a janela foi ocultada.')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearTimeout(sessionTimer.current)
      listener.current?.stop()
      listener.current = null
    }
  }, [])

  return { phase, notice, active: phase !== 'off', start, stop: () => end(), interruptNow, clearNotice: () => setNotice(null) }
}
