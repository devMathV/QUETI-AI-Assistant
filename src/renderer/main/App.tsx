import { useEffect, useState } from 'react'
import type { MainPage } from '../../shared/types'
import ChatView from '../shared/ChatView'
import Diagnostics from './Diagnostics'
import History from './History'
import Memory from './Memory'
import Privacy from './Privacy'
import Settings from './Settings'

const NAV: { id: MainPage; label: string }[] = [
  { id: 'chat', label: 'Conversa' },
  { id: 'history', label: 'Histórico' },
  { id: 'memory', label: 'Memória' },
  { id: 'settings', label: 'Configurações' },
  { id: 'privacy', label: 'Privacidade e dados' },
  { id: 'diagnostics', label: 'Diagnóstico' }
]

const isPage = (v: string): v is MainPage => NAV.some((n) => n.id === v)

export default function App() {
  const [page, setPage] = useState<MainPage>(() => {
    const h = location.hash.slice(1)
    return isPage(h) ? h : 'chat'
  })

  // O processo principal pode pedir para trocar de página (ex.: "Configurações" na bandeja).
  useEffect(() => window.api.windows.onNavigate(setPage), [])

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Seções">
        <h1 className="sidebar__title">Assistente</h1>
        <ul>
          {NAV.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="nav-btn"
                aria-current={page === n.id ? 'page' : undefined}
                onClick={() => setPage(n.id)}
              >
                {n.label}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="quit-btn" onClick={() => window.api.windows.quit()}>
          Encerrar o assistente
        </button>
      </nav>

      <main className="content">
        {page === 'chat' && (
          <div className="chat-page">
            <div className="chat-page__bar">
              <h2>Conversa</h2>
              <button type="button" className="text-btn" onClick={() => window.api.chat.newConversation()}>
                Nova conversa
              </button>
            </div>
            <ChatView variant="full" />
          </div>
        )}
        {page === 'history' && <History onOpened={() => setPage('chat')} />}
        {page === 'memory' && <Memory />}
        {page === 'settings' && <Settings />}
        {page === 'privacy' && <Privacy />}
        {page === 'diagnostics' && <Diagnostics />}
      </main>
    </div>
  )
}
