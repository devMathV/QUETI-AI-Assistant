import { useEffect, useState } from 'react'
import ChatView from '../shared/ChatView'
import { CloseIcon, ExpandIcon, PinIcon, PlusIcon } from '../shared/Icons'
import { useAiConfig } from '../shared/useAiConfig'
import { useChatStatus } from '../shared/useChat'

export default function Compact() {
  const [pinned, setPinned] = useState(false)
  const [focusToken, setFocusToken] = useState(0)
  const config = useAiConfig()
  const status = useChatStatus()

  useEffect(() => {
    const applyEdge = (edge: string) => {
      document.body.dataset.edge = edge
    }
    void window.api.settings.get().then((s) => applyEdge(s.widgetEdge))
    const offSettings = window.api.settings.onChanged((s) => applyEdge(s.widgetEdge))

    const offVisible = window.api.windows.onCompactVisible((v) => v && setFocusToken((t) => t + 1))

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.api.windows.hideCompact()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offSettings()
      offVisible()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  function togglePin() {
    const next = !pinned
    setPinned(next)
    window.api.windows.setCompactPinned(next)
  }

  let statusText = ''
  if (config) {
    if (!config.hasKey) statusText = 'Sem chave de API'
    else if (status === 'thinking') statusText = 'Pensando…'
    else if (status === 'streaming') statusText = 'Respondendo…'
    else statusText = `${config.providerLabel} · ${config.model}`
  }

  return (
    <div className="shell">
      <section className="panel" aria-label="Chat rápido do QUETI">
        <header className="panel__header">
          <div>
            <h1 className="panel__title">QUETI</h1>
            <p className="panel__status" title={statusText}>
              {statusText}
            </p>
          </div>
          <div className="panel__actions">
            <button
              type="button"
              className="icon-btn"
              aria-label="Nova conversa"
              title="Nova conversa"
              onClick={() => window.api.chat.newConversation()}
            >
              <PlusIcon />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-pressed={pinned}
              aria-label={pinned ? 'Desafixar janela' : 'Manter janela aberta'}
              title={pinned ? 'Desafixar (volta a fechar ao clicar fora)' : 'Manter aberta ao clicar fora'}
              onClick={togglePin}
            >
              <PinIcon />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Abrir no aplicativo"
              title="Abrir no aplicativo"
              onClick={() => window.api.windows.openMain('chat')}
            >
              <ExpandIcon />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Fechar"
              title="Fechar (Esc)"
              onClick={() => window.api.windows.hideCompact()}
            >
              <CloseIcon />
            </button>
          </div>
        </header>
        <ChatView variant="compact" focusToken={focusToken} />
      </section>
    </div>
  )
}
