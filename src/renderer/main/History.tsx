import { useCallback, useEffect, useState } from 'react'
import type { ConversationSummary } from '../../shared/types'

const formatDate = (ts: number) => new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export default function History({ onOpened }: { onOpened: () => void }) {
  const [items, setItems] = useState<ConversationSummary[] | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const refresh = useCallback(() => void window.api.history.list().then(setItems), [])
  useEffect(() => {
    refresh()
    return window.api.history.onChanged(refresh)
  }, [refresh])

  async function open(id: string) {
    const ok = await window.api.history.open(id)
    if (ok) onOpened()
    else setFeedback('Não foi possível abrir esta conversa.')
  }

  async function remove(id: string) {
    const r = await window.api.history.remove(id)
    if (!r.canceled) setFeedback(r.message)
  }

  return (
    <div className="page">
      <h2>Histórico</h2>
      <p className="hint">
        Conversas salvas neste computador. “Nova conversa” guarda a atual aqui e começa uma em branco. Você pode desativar o salvamento ou
        definir um prazo em Privacidade e dados.
      </p>

      {feedback && (
        <p className="status-line status-line--ok" role="status">
          {feedback}
        </p>
      )}

      {items && items.length === 0 && <p>Nenhuma conversa salva ainda.</p>}

      <ul className="list">
        {items?.map((c) => (
          <li key={c.id} className="list__item">
            <div className="list__main">
              <strong className="list__title">{c.title}</strong>
              <span className="hint">
                {formatDate(c.updatedAt)} · {c.messageCount} {c.messageCount === 1 ? 'mensagem' : 'mensagens'}
                {c.current ? ' · conversa atual' : ''}
              </span>
            </div>
            <div className="list__actions">
              <button type="button" className="text-btn text-btn--small" onClick={() => void open(c.id)} disabled={c.current}>
                Abrir
              </button>
              <button type="button" className="text-btn text-btn--small" onClick={() => void remove(c.id)}>
                Apagar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
