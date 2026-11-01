import { useEffect, useState } from 'react'
import type { SearchConfig } from '../../shared/types'
import { useSettings } from '../shared/useSettings'

export default function WebSearchSettings() {
  const [config, setConfig] = useState<SearchConfig | null>(null)
  const settings = useSettings()
  const [keyDraft, setKeyDraft] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    let active = true
    const off = window.api.search.onConfigChanged((c) => active && setConfig(c))
    void window.api.search.getConfig().then((c) => active && setConfig(c))
    return () => {
      active = false
      off()
    }
  }, [])

  if (!config) return null

  async function saveKey() {
    const r = await window.api.search.setKey(keyDraft)
    if (r.ok) {
      setKeyDraft('')
      setFeedback({ kind: 'ok', text: 'Chave salva (criptografada pelo Windows).' })
    } else setFeedback({ kind: 'error', text: r.error })
  }

  async function removeKey() {
    const r = await window.api.search.removeKey()
    setFeedback(r.ok ? { kind: 'ok', text: 'Chave removida.' } : { kind: 'error', text: r.error })
  }

  async function test() {
    setTesting(true)
    setFeedback(null)
    const r = await window.api.search.test()
    setFeedback({ kind: r.ok ? 'ok' : 'error', text: r.message })
    setTesting(false)
  }

  return (
    <section className="card" aria-labelledby="web-title">
      <h3 id="web-title">Pesquisa na web (Tavily)</h3>
      <p className="hint">
        Como usar: no chat, clique em <strong>+</strong> → “Pesquisar na web”, ou escreva “Pesquise …”. A resposta mostra as fontes com links.
        Sem chave, o assistente avisa e oferece pesquisar no navegador padrão.
      </p>
      <p>
        {config.hasKey ? 'Chave do Tavily salva.' : 'Nenhuma chave do Tavily salva.'}{' '}
        {config.hasKey && (
          <button type="button" className="text-btn text-btn--small" onClick={() => void removeKey()}>
            Remover chave
          </button>
        )}
      </p>
      {!config.hasKey && (
        <>
          <ol className="steps">
            <li>
              Abra{' '}
              <a href="https://app.tavily.com" target="_blank" rel="noreferrer">
                app.tavily.com
              </a>{' '}
              e crie uma conta (plano gratuito, sem cartão).
            </li>
            <li>Copie a chave de API (ela começa com tvly-).</li>
            <li>Cole abaixo e clique em “Salvar chave”.</li>
          </ol>
          <div className="field">
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="tvly-..."
              aria-label="Chave de API do Tavily"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="text-btn" onClick={() => void saveKey()} disabled={!keyDraft.trim() || !config.secureStorage}>
              Salvar chave
            </button>
          </div>
        </>
      )}
      {settings && (
        <label className="row">
          <input type="checkbox" checked={settings.autoSearch} onChange={(e) => void window.api.settings.update({ autoSearch: e.target.checked })} />
          Pesquisar sozinho quando a pergunta pedir informação atual (notícias, cotações, placar, previsão do tempo)
        </label>
      )}
      <p>
        <button type="button" className="text-btn" onClick={() => void test()} disabled={!config.hasKey || testing}>
          {testing ? 'Testando…' : 'Testar (usa 1 crédito)'}
        </button>
      </p>
      {feedback && (
        <p className={`status-line status-line--${feedback.kind}`} role="status">
          {feedback.text}
        </p>
      )}
      <p className="hint">
        Buscas contadas neste mês: {config.usedThisMonth} de {config.monthlyFree} (contagem local; vale o painel do Tavily). Cada busca básica
        usa 1 crédito. Segundo a documentação do Tavily, o plano gratuito tem {config.monthlyFree} créditos por mês, sem cartão.
      </p>
      <p className="hint">
        O que é enviado: a sua pergunta vai ao Tavily para buscar. Os trechos dos resultados vão à Groq junto com a pergunta, para ela
        responder citando as fontes. Arquivos e alterações do Git anexados vão só à Groq (apenas trechos relevantes), nunca ao Tavily.
      </p>
    </section>
  )
}
