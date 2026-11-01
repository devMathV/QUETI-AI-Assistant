import { useCallback, useEffect, useState } from 'react'
import type { DataAction, DataInfo, Settings } from '../../shared/types'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const RETENTION: { value: number; label: string }[] = [
  { value: 0, label: 'Manter até eu apagar' },
  { value: 30, label: 'Apagar após 30 dias' },
  { value: 90, label: 'Apagar após 90 dias' },
  { value: 365, label: 'Apagar após 1 ano' }
]

export default function Privacy() {
  const [info, setInfo] = useState<DataInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const refreshInfo = useCallback(() => void window.api.data.info().then(setInfo), [])
  useEffect(() => {
    refreshInfo()
    void window.api.settings.get().then(setSettings)
    const offHistory = window.api.history.onChanged(refreshInfo)
    const offMemory = window.api.memory.onChanged(refreshInfo)
    const offSettings = window.api.settings.onChanged(setSettings)
    return () => {
      offHistory()
      offMemory()
      offSettings()
    }
  }, [refreshInfo])

  async function run(action: () => Promise<DataAction>) {
    const r = await action()
    if (!r.canceled) setFeedback({ kind: r.ok ? 'ok' : 'error', text: r.message })
    refreshInfo()
  }

  async function update(patch: Parameters<typeof window.api.settings.update>[0]) {
    setSettings(await window.api.settings.update(patch))
    refreshInfo()
  }

  if (!settings || !info) return null

  return (
    <div className="page">
      <h2>Privacidade e dados</h2>

      {!info.dbAvailable && (
        <p className="hint hint--warn" role="alert">
          Armazenamento local indisponível{info.dbError ? ` (${info.dbError})` : ''}. O assistente funciona, mas nada é salvo: as conversas
          e a memória duram só até você encerrar o aplicativo.
        </p>
      )}

      <section className="card">
        <h3>Preferências</h3>
        <label className="row">
          <input type="checkbox" checked={settings.saveHistory} onChange={(e) => void update({ saveHistory: e.target.checked })} />
          Salvar o histórico das conversas neste computador
        </label>
        <label className="row">
          <input type="checkbox" checked={settings.useMemory} onChange={(e) => void update({ useMemory: e.target.checked })} />
          Usar a memória nas respostas (envia à IA os itens relevantes à pergunta)
        </label>
        <div className="row">
          <label htmlFor="retention">Retenção do histórico</label>
          <select id="retention" className="select" value={settings.retentionDays} onChange={(e) => void update({ retentionDays: Number(e.target.value) })}>
            {RETENTION.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <p className="hint">
          Só mensagens suas e do assistente são salvas. Avisos e erros do aplicativo, não. Nada é sincronizado com a nuvem: cada instalação
          guarda os próprios dados.
        </p>
      </section>

      <section className="card">
        <h3>Onde ficam seus dados</h3>
        <p>
          Pasta: <code>{info.folder}</code>
        </p>
        <ul className="plain">
          <li>
            <code>assistente.db</code>: conversas e memória ({info.conversations} conversas, {info.messages} mensagens, {info.memories} itens da memória;{' '}
            {formatSize(info.sizeBytes)})
          </li>
          <li>
            <code>settings.json</code>: preferências do aplicativo
          </li>
          <li>
            <code>secrets.json</code>: chave de API, criptografada pelo Windows
          </li>
        </ul>
        <p className="hint">
          Limitação importante: apenas a chave de API é criptografada. O banco de conversas e memória fica em um arquivo comum; quem tiver acesso
          à sua conta do Windows ou ao disco consegue lê-lo. Para proteger o disco todo, use o BitLocker ou a criptografia de dispositivo do
          Windows.
        </p>
      </section>

      <section className="card">
        <h3>Seus dados</h3>
        <div className="row row--wrap">
          <button type="button" className="text-btn" onClick={() => void run(window.api.data.exportAll)}>
            Exportar meus dados (JSON)
          </button>
          <button type="button" className="text-btn" onClick={() => void run(window.api.data.deleteHistory)}>
            Apagar histórico
          </button>
          <button type="button" className="text-btn" onClick={() => void run(window.api.data.deleteMemory)}>
            Apagar memória
          </button>
          <button type="button" className="text-btn text-btn--danger" onClick={() => void run(window.api.data.deleteEverything)}>
            Apagar todos os dados
          </button>
        </div>
        <p className="hint">
          A exportação inclui conversas, memória e preferências, e nunca a chave de API. “Apagar todos os dados” também remove a chave de
          API e restaura as configurações iniciais. Toda exclusão pede confirmação.
        </p>
        {feedback && (
          <p className={`status-line status-line--${feedback.kind}`} role="status">
            {feedback.text}
          </p>
        )}
      </section>
    </div>
  )
}
