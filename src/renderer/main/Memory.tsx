import { useCallback, useEffect, useState } from 'react'
import type { MemoryItem } from '../../shared/types'

const MAX_ITEMS = 200

export default function Memory() {
  const [items, setItems] = useState<MemoryItem[]>([])
  const [draft, setDraft] = useState('')
  const [always, setAlways] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [storageOk, setStorageOk] = useState(true)

  const refresh = useCallback(() => void window.api.memory.list().then(setItems), [])
  useEffect(() => {
    refresh()
    void window.api.data.info().then((i) => setStorageOk(i.dbAvailable))
    return window.api.memory.onChanged(refresh)
  }, [refresh])

  async function add() {
    setError(null)
    const r = await window.api.memory.add(draft, always)
    if (r.ok) {
      setDraft('')
      setAlways(false)
      if (r.duplicate) setError('Isso já estava na memória.')
    } else {
      setError(r.error)
    }
  }

  async function saveEdit() {
    if (!editing) return
    const r = await window.api.memory.update(editing.id, { content: editing.text })
    if (r.ok) {
      setEditing(null)
      setError(null)
    } else {
      setError(r.error)
    }
  }

  return (
    <div className="page">
      <h2>Memória</h2>
      <p className="hint">
        Só entra aqui o que você pedir. No chat, escreva por exemplo “Lembre-se de que prefiro respostas curtas”. Nas respostas, só vão para
        a IA os itens que parecem relevantes à sua pergunta, mais os marcados como “sempre”. Você pode desligar o uso da memória em Privacidade e
        dados.
      </p>

      {!storageOk && (
        <p className="hint hint--warn" role="alert">
          O armazenamento local está indisponível, então a memória não pode ser salva. Veja detalhes em Privacidade e dados.
        </p>
      )}

      <section className="card" aria-label="Adicionar à memória">
        <label className="field-label" htmlFor="mem-new">
          Novo item
        </label>
        <textarea
          id="mem-new"
          className="textarea"
          rows={2}
          maxLength={500}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ex.: Prefiro respostas curtas e em tópicos"
        />
        <div className="row">
          <label>
            <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> Usar sempre
          </label>
          <button type="button" className="text-btn" onClick={() => void add()} disabled={!draft.trim() || !storageOk}>
            Adicionar
          </button>
        </div>
        {error && (
          <p className="status-line status-line--error" role="alert">
            {error}
          </p>
        )}
      </section>

      <p className="hint">
        {items.length} de {MAX_ITEMS} itens
      </p>
      {items.length === 0 && <p>A memória está vazia.</p>}

      <ul className="list">
        {items.map((m) => (
          <li key={m.id} className="list__item">
            <div className="list__main">
              {editing?.id === m.id ? (
                <textarea
                  className="textarea"
                  rows={2}
                  maxLength={500}
                  value={editing.text}
                  aria-label="Editar item"
                  onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                />
              ) : (
                <span className="list__text">{m.content}</span>
              )}
              <label className="hint">
                <input
                  type="checkbox"
                  checked={m.always}
                  onChange={(e) => void window.api.memory.update(m.id, { always: e.target.checked })}
                />{' '}
                Usar sempre
              </label>
            </div>
            <div className="list__actions">
              {editing?.id === m.id ? (
                <>
                  <button type="button" className="text-btn text-btn--small" onClick={() => void saveEdit()}>
                    Salvar
                  </button>
                  <button type="button" className="text-btn text-btn--small" onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="text-btn text-btn--small" onClick={() => setEditing({ id: m.id, text: m.content })}>
                    Editar
                  </button>
                  <button type="button" className="text-btn text-btn--small" onClick={() => void window.api.memory.remove(m.id)}>
                    Apagar
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
