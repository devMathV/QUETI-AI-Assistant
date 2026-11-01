import { useEffect, useState } from 'react'
import AiSettings from './AiSettings'
import TranscriptionSettings from './TranscriptionSettings'
import VoiceSettings from './VoiceSettings'
import WebSearchSettings from './WebSearchSettings'
import type { Diagnostics, Edge, Settings as SettingsData } from '../../shared/types'

const prettyShortcut = (s: string) => s.replace('CommandOrControl', 'Ctrl').replace(/\+/g, ' + ')

export default function Settings() {
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [info, setInfo] = useState<Diagnostics | null>(null)

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    void window.api.diagnostics.get().then(setInfo)
    return window.api.settings.onChanged(setSettings)
  }, [])

  if (!settings) return null

  const setEdge = (edge: Edge) => void window.api.settings.update({ widgetEdge: edge })
  const setEnabled = (on: boolean) => void window.api.settings.update({ widgetEnabled: on })

  return (
    <div className="page">
      <h2>Configurações</h2>

      <AiSettings />

      <WebSearchSettings />

      <VoiceSettings />

      <TranscriptionSettings />

      <section className="card">
        <h3>Botão flutuante</h3>
        <label className="row">
          <input type="checkbox" checked={settings.widgetEnabled} onChange={(e) => setEnabled(e.target.checked)} />
          Mostrar o botão na borda da tela
        </label>
        <fieldset className="row radios">
          <legend>Lado da tela</legend>
          <label>
            <input type="radio" name="edge" checked={settings.widgetEdge === 'left'} onChange={() => setEdge('left')} />
            Esquerda
          </label>
          <label>
            <input type="radio" name="edge" checked={settings.widgetEdge === 'right'} onChange={() => setEdge('right')} />
            Direita
          </label>
        </fieldset>
        <p className="hint">Para mudar a altura, arraste o botão para cima ou para baixo.</p>
      </section>

      <section className="card">
        <h3>Atalho para abrir o chat rápido</h3>
        <p>
          <kbd>{prettyShortcut(settings.shortcut)}</kbd>
        </p>
        {info && !info.shortcutRegistered && (
          <p className="hint hint--warn" role="alert">
            Não foi possível ativar este atalho. Outro programa pode estar usando a mesma combinação. Você ainda pode abrir o chat pelo botão ou pela bandeja do Windows.
          </p>
        )}
        <p className="hint">A troca do atalho pela interface será adicionada em uma próxima versão.</p>
      </section>

    </div>
  )
}
