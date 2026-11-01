import { useEffect, useState } from 'react'
import type { ChatMessage, ChatStatus, SendMeta } from '../../shared/types'

/** Conversa compartilhada: o estado vive no processo principal. */
export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<ChatStatus>('idle')

  useEffect(() => {
    let active = true
    // Primeiro assina as atualizações; depois busca o estado atual.
    const offMessages = window.api.chat.onUpdated((m) => active && setMessages(m))
    const offStatus = window.api.chat.onStatus((s) => active && setStatus(s))
    void window.api.chat.getHistory().then((m) => active && setMessages(m))
    void window.api.chat.getStatus().then((s) => active && setStatus(s))
    return () => {
      active = false
      offMessages()
      offStatus()
    }
  }, [])

  return {
    messages,
    status,
    send: (text: string, meta?: SendMeta) => window.api.chat.send(text, meta),
    cancel: () => window.api.chat.cancel(),
    newConversation: () => window.api.chat.newConversation()
  }
}

/** Só o status (usado em cabeçalhos que não precisam das mensagens). */
export function useChatStatus(): ChatStatus {
  const [status, setStatus] = useState<ChatStatus>('idle')
  useEffect(() => {
    let active = true
    const off = window.api.chat.onStatus((s) => active && setStatus(s))
    void window.api.chat.getStatus().then((s) => active && setStatus(s))
    return () => {
      active = false
      off()
    }
  }, [])
  return status
}
