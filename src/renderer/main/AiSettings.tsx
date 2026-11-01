import { useEffect, useState } from 'react'
import { useAiConfig } from '../shared/useAiConfig'

interface Feedback {
  kind: 'ok' | 'error'
  text: string
}

export default function AiSettings() {
  const config = useAiConfig()
  const [keyDraft, setKeyDraft] = useState('')
  const [modelDraft, setModelDraft] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (config) setModelDraft(config.model)
  }, [config?.model])

  if (!config) return null

  async function saveKey() {
    const r = await window.api.ai.setKey(keyDraft)
    if (r.ok) {
      setKeyDraft('')
      setFeedback({ kind: 'ok', text: 'Chave salva (criptografada pelo Windows). Use “Testar conexão” para conferir.' })
    } else {
      setFeedback({ kind: 'error', text: r.error })
    }
  }

  async function removeKey() {
    const r = await window.api.ai.removeKey()
    setFeedback(r.ok ? { kind: 'ok', text: 'Chave removida.' } : { kind: 'error', text: r.error })
    setSuggestions([])
  }

  async function saveModel(value: string) {
    const r = await window.api.ai.setModel(value)
    setFeedback(r.ok ? { kind: 'ok', text: 'Modelo salvo.' } : { kind: 'error', text: r.error })
  }

  async function test() {
    setTesting(true)
    setFeedback(null)
    setSuggestions([])
    const r = await window.api.ai.testConnection()
    setFeedback({ kind: r.ok && r.modelFound !== false ? 'ok' : 'error', text: r.message })
    if (r.ok && r.modelFound === false && r.suggestions) setSuggestions(r.suggestions)
    setTesting(false)
  }

  return (
    <section className="card" aria-labelledby="ai-title">
      <h3 id="ai-title">Inteligência artificial ({config.providerLabel})</h3>

      {!config.secureStorage && (
        <p className="hint hint--warn" role="alert">
          O Windows não disponibilizou o armazenamento seguro de credenciais, então a chave não pode ser salva com segurança.
        </p>
      )}

      <p>
        {config.hasKey ? 'Chave de API salva.' : 'Nenhuma chave de API salva.'}{' '}
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
              <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">
                console.groq.com/keys
              </a>{' '}
              e entre com uma conta (o plano gratuito basta).
            </li>
            <li>Clique em “Create API Key”, dê um nome e copie a chave (ela começa com gsk_).</li>
            <li>Cole a chave abaixo e clique em “Salvar chave”.</li>
          </ol>
          <div className="field">
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="gsk_..."
              aria-label="Chave de API da Groq"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="text-btn" onClick={() => void saveKey()} disabled={!keyDraft.trim() || !config.secureStorage}>
              Salvar chave
            </button>
          </div>
        </>
      )}

      <div className="field">
        <input
          type="text"
          value={modelDraft}
          onChange={(e) => setModelDraft(e.target.value)}
          aria-label="Modelo de IA"
          spellCheck={false}
        />
        <button type="button" className="text-btn" onClick={() => void saveModel(modelDraft)} disabled={modelDraft.trim() === config.model}>
          Salvar modelo
        </button>
        <button type="button" className="text-btn" onClick={() => setModelDraft(config.defaultModel)}>
          Padrão
        </button>
      </div>

      <p>
        <button type="button" className="text-btn" onClick={() => void test()} disabled={!config.hasKey || testing}>
          {testing ? 'Testando…' : 'Testar conexão'}
        </button>
      </p>

      {feedback && (
        <p className={`status-line status-line--${feedback.kind}`} role="status">
          {feedback.text}
        </p>
      )}
      {suggestions.length > 0 && (
        <div className="chips" aria-label="Modelos sugeridos">
          {suggestions.map((m) => (
            <button
              key={m}
              type="button"
              className="chip"
              onClick={() => {
                setModelDraft(m)
                void saveModel(m)
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}

      <h3 style={{ marginTop: 16 }}>Limites e dados enviados</h3>
      <p className="hint">
        Valores de referência da documentação da Groq (outubro de 2026) para o modelo padrão: 30 pedidos por minuto, 1.000 por dia, 8.000
        tokens por minuto e 200.000 tokens por dia. A própria página os descreve como limites base e remete à página de limites da conta, então
        confira os valores exatos do seu plano em{' '}
        <a href="https://console.groq.com/settings/limits" target="_blank" rel="noreferrer">
          console.groq.com/settings/limits
        </a>
        . Os limites valem para a organização, e não para a chave, e podem mudar. Ao atingi-los, o assistente avisa.
      </p>
      <p className="hint">
        A cada mensagem, são enviados à Groq: as instruções do sistema, suas mensagens recentes (cerca de 6.000 caracteres de histórico) e a
        chave de API. Arquivos, tela e memória não são enviados. Leia a política de privacidade da Groq antes de enviar dados sensíveis.
      </p>
    </section>
  )
}
