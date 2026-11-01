import { useEffect, useRef } from 'react'
import type { ChatMessage, ChatStatus } from '../../shared/types'
import type { useSpeech } from './useSpeech'
import { speechText, type SpeechSession } from './voice/tts'

type Speech = ReturnType<typeof useSpeech>

/** Posição (em caracteres) até onde já há frases completas para falar. */
function completedUpTo(text: string, final: boolean): number {
  if (final) return text.length
  let end = 0
  for (const m of text.matchAll(/[.!?…](?=\s)/g)) end = (m.index ?? 0) + 1
  if (end > 0) return end
  // Frase muito longa sem pontuação: corta em um espaço para não demorar a começar.
  if (text.length > 140) {
    const cut = text.lastIndexOf(' ', 140)
    if (cut > 60) return cut
  }
  return 0
}

/**
 * Lê a resposta do assistente ENQUANTO ela chega, frase a frase: a primeira frase começa a ser
 * falada assim que estiver completa, sem esperar o fim da resposta.
 *
 * Uso: chame arm() ao enviar uma mensagem. O callback (opcional) roda quando a fala terminar,
 * ou quando ficar claro que não haverá resposta falada (erro, cancelamento, pedido tratado localmente).
 */
export function useReplySpeaker(messages: ChatMessage[], status: ChatStatus, speech: Speech) {
  const armed = useRef<{ onDone?: () => void } | null>(null)
  const session = useRef<{ id: string; session: SpeechSession; spoken: number; ended: boolean } | null>(null)
  const starting = useRef(false)
  const failed = useRef(false)
  const sawBusy = useRef(false)
  const latest = useRef({ messages, status, speech })
  latest.current = { messages, status, speech }

  function finish() {
    const done = armed.current?.onDone
    armed.current = null
    session.current = null
    starting.current = false
    failed.current = false
    sawBusy.current = false
    done?.()
  }

  function feed() {
    const { messages, status, speech } = latest.current
    if (!armed.current) return
    if (status !== 'idle') sawBusy.current = true

    let lastUser = -1
    messages.forEach((m, i) => {
      if (m.role === 'user') lastUser = i
    })
    const reply = messages
      .slice(lastUser + 1)
      .reverse()
      .find((m) => m.role === 'assistant')

    if (!reply) {
      // Terminou (erro ou cancelamento) sem nenhuma resposta: nada a falar.
      if (status === 'idle' && sawBusy.current) finish()
      return
    }
    if (failed.current) {
      if (status === 'idle') finish()
      return
    }
    if (!session.current) {
      if (starting.current) return
      starting.current = true
      const id = reply.id
      void speech.begin(id, () => finish()).then((s) => {
        starting.current = false
        if (!armed.current) {
          s?.stop()
          return
        }
        if (s) session.current = { id, session: s, spoken: 0, ended: false }
        else failed.current = true
        feed()
      })
      return
    }

    const s = session.current
    if (s.ended) return
    const final = status === 'idle'
    const clean = speechText(reply.text)
    const pending = clean.slice(s.spoken)
    const upTo = completedUpTo(pending, final)
    if (upTo > 0) {
      s.session.enqueue(pending.slice(0, upTo))
      s.spoken += upTo
    }
    if (final) {
      s.ended = true
      s.session.end() // onDone é chamado quando a fala terminar
    }
  }

  useEffect(() => {
    feed()
  }, [messages, status])

  // Ao sair da tela, nada fica falando.
  useEffect(
    () => () => {
      armed.current = null
      session.current?.session.stop()
      session.current = null
    },
    []
  )

  return {
    arm(onDone?: () => void) {
      const mine = { onDone }
      armed.current = mine
      session.current = null
      starting.current = false
      failed.current = false
      sawBusy.current = false
      // Pedidos tratados só localmente (ex.: "lembre-se...") não geram resposta da IA: não ficamos esperando.
      window.setTimeout(() => {
        if (armed.current === mine && !sawBusy.current && latest.current.status === 'idle') finish()
      }, 2000)
    },
    cancel() {
      armed.current = null
      session.current?.session.stop()
      session.current = null
      starting.current = false
      sawBusy.current = false
    }
  }
}
