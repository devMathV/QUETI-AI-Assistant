import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { AttachResult, Grant, GrantKind, ToolLogEntry } from '../../shared/types'
import { useSettings } from '../shared/useSettings'

const KIND_LABEL: Record<GrantKind, string> = {
  site: 'abrir',
  site_read: 'ler conteúdo',
  app: 'aplicativo',
  folder_read: 'leitura',
  folder_write: 'leitura e escrita',
  browser_read: 'ler abas'
}

const OUTCOME_LABEL: Record<ToolLogEntry['outcome'], string> = { done: 'feito', denied: 'negado', error: 'erro' }

const formatTime = (ts: number) => new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export default function Permissions() {
  const settings = useSettings()
  const [grants, setGrants] = useState<Grant[]>([])
  const [log, setLog] = useState<ToolLogEntry[]>([])
  const [domain, setDomain] = useState('')
  const [mode, setMode] = useState<'open' | 'read'>('open')
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [browserInfo, setBrowserInfo] = useState<{ enabled: boolean; port: number | null; connected: boolean; pairingCode: string | null } | null>(null)

  const refresh = useCallback(() => {
    void window.api.permissions.list().then(setGrants)
    void window.api.permissions.log().then(setLog)
  }, [])

  useEffect(() => {
    refresh()
    void window.api.permissions.browserInfo().then(setBrowserInfo)
    const timer = window.setInterval(() => void window.api.permissions.browserInfo().then(setBrowserInfo), 2000)
    const off = window.api.permissions.onChanged(refresh)
    return () => {
      window.clearInterval(timer)
      off()
    }
  }, [refresh])

  async function toggleBrowserBridge(enabled: boolean) {
    const next = await window.api.settings.update({ browserBridge: enabled })
    setBrowserInfo(await window.api.permissions.browserInfo())
    if (next.browserBridge !== enabled) setFeedback({ kind: 'error', text: 'Não foi possível atualizar a ponte.' })
  }

  async function copyPairingCode() {
    const code = browserInfo?.pairingCode
    if (!code) return
    window.api.clipboard.copy(code)
    setFeedback({ kind: 'ok', text: 'Código copiado.' })
  }

  async function run(action: () => Promise<AttachResult>) {
    const r = await action()
    if (r.canceled) return
    setFeedback({ kind: r.ok ? 'ok' : 'error', text: r.message })
  }

  async function revoke(id: string) {
    try {
      await window.api.permissions.revoke(id)
      await refresh()
    } catch (error) {
      setFeedback({ kind: 'error', text: error instanceof Error ? error.message : 'Não foi possível revogar a permissão.' })
    }
  }

  const section = (title: string, kinds: GrantKind[], actions: ReactNode, empty: string) => {
    const items = grants.filter((g) => kinds.includes(g.kind))
    return (
      <section className="card" aria-label={title}>
        <h3>{title}</h3>
        {items.length === 0 && <p className="hint">{empty}</p>}
        <ul className="list">
          {items.map((g) => (
            <li key={g.id} className="list__item">
              <div className="list__main">
                <strong className="list__title">{g.label}</strong>
                {g.kind !== 'site' && g.kind !== 'site_read' && <span className="list__path">{g.target}</span>}
              </div>
              <div className="list__actions">
                <span className="tag">{KIND_LABEL[g.kind]}</span>
                <button
                  type="button"
                  className="text-btn text-btn--small"
                  onClick={() => void revoke(g.id)}
                >
                  Revogar
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="row row--wrap">{actions}</div>
      </section>
    )
  }

  return (
    <div className="page">
      <h2>Permissões</h2>

      <section className="card">
        <h3>Navegador</h3>
        <label className="row">
          <input type="checkbox" checked={settings?.browserBridge ?? false} onChange={(e) => void toggleBrowserBridge(e.target.checked)} />
          Ativar ponte do navegador
        </label>
        <p className="hint">A extensão só lê uma aba quando o QUETI pedir. Instale a extensão da pasta extension e cole o código abaixo.</p>
        {browserInfo?.enabled && (
          <>
            <p className="hint">Status: {browserInfo.connected ? 'conectada' : 'aguardando extensão'}.</p>
            <code>{browserInfo.pairingCode}</code>
            <button type="button" className="text-btn" onClick={() => void copyPairingCode()}>
              Copiar código
            </button>
            <button type="button" className="text-btn" onClick={() => void window.api.permissions.regenerateBrowserCode().then((r) => setBrowserInfo((i) => i ? { ...i, pairingCode: r.pairingCode } : i))}>
              Gerar novo código
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h3>Ferramentas do QUETI</h3>
        <label className="row">
          <input
            type="checkbox"
            checked={settings?.toolsEnabled ?? false}
            onChange={(e) => void window.api.settings.update({ toolsEnabled: e.target.checked })}
          />
          Permitir que o QUETI use ferramentas quando eu pedir uma ação
        </label>
        <p className="hint">
          Desligado por padrão. Ligado, ele pode abrir sites e aplicativos autorizados, ler páginas e arquivos de pastas autorizadas e criar,
          alterar ou apagar arquivos. Cada recurso tem a sua permissão, que você concede e revoga aqui. Criar, alterar e apagar arquivos sempre
          pedem confirmação, e depois que ele lê conteúdo externo (web ou arquivos), abrir endereços e aplicativos também passa a pedir. Ativar
          as ferramentas usa um pouco mais da cota de texto da Groq.
        </p>
        <label className="row">
          Autonomia para alvos citados no pedido
          <select
            className="select"
            value={settings?.autonomy ?? 'explicit'}
            onChange={(e) => void window.api.settings.update({ autonomy: e.target.value as 'explicit' | 'ask' })}
          >
            <option value="explicit">Acessar sem perguntar quando eu citar o alvo</option>
            <option value="ask">Perguntar sempre</option>
          </select>
        </label>
        <p className="hint">A regra vale só para leitura e abertura do alvo citado nesta mensagem. Criar, alterar e apagar sempre pedem confirmação.</p>
        {feedback && (
          <p className={`status-line status-line--${feedback.kind}`} role="status">
            {feedback.text}
          </p>
        )}
      </section>

      {section(
        'Aplicativos autorizados',
        ['app'],
        <button type="button" className="text-btn" onClick={() => void run(window.api.permissions.addApp)}>
          Adicionar aplicativo…
        </button>,
        'Nenhum aplicativo autorizado. O QUETI só abre os que estiverem nesta lista.'
      )}

      {section(
        'Sites autorizados',
        ['site', 'site_read'],
        <>
          <input
            type="text"
            className="textarea"
            style={{ maxWidth: 260 }}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="exemplo.com.br"
            aria-label="Endereço do site"
            spellCheck={false}
          />
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value as 'open' | 'read')} aria-label="Tipo de permissão">
            <option value="open">Abrir no navegador</option>
            <option value="read">Ler o conteúdo</option>
          </select>
          <button
            type="button"
            className="text-btn"
            disabled={!domain.trim()}
            onClick={() => {
              void run(() => window.api.permissions.addSite(domain, mode))
              setDomain('')
            }}
          >
            Adicionar site
          </button>
        </>,
        'Nenhum site autorizado. Na primeira vez que o QUETI precisar de um site, ele pergunta.'
      )}

      {section(
        'Pastas autorizadas',
        ['folder_read', 'folder_write'],
        <>
          <button type="button" className="text-btn" onClick={() => void run(() => window.api.permissions.addFolder('read'))}>
            Adicionar pasta (leitura)…
          </button>
          <button type="button" className="text-btn" onClick={() => void run(() => window.api.permissions.addFolder('write'))}>
            Adicionar pasta (leitura e escrita)…
          </button>
        </>,
        'Nenhuma pasta autorizada. A autorização vale para a pasta e suas subpastas.'
      )}

      <section className="card">
        <h3>Atividade recente</h3>
        {log.length === 0 && <p className="hint">Nenhuma ação registrada.</p>}
        {log.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Quando</th>
                  <th scope="col">Ação</th>
                  <th scope="col">Alvo</th>
                  <th scope="col">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {log.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatTime(entry.ts)}</td>
                    <td>{entry.tool}</td>
                    <td className="list__path">{entry.target}</td>
                    <td>{OUTCOME_LABEL[entry.outcome]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {log.length > 0 && (
          <p>
            <button type="button" className="text-btn text-btn--small" onClick={() => window.api.permissions.clearLog()}>
              Limpar registro
            </button>
          </p>
        )}
      </section>
    </div>
  )
}
