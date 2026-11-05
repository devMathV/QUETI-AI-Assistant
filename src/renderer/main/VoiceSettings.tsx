import { useEffect, useState } from 'react'
import type { BargeInMode, ReplyLength } from '../../shared/types'
import { useSettings } from '../shared/useSettings'
import { NO_VOICE_MESSAGE, listPortugueseVoices, speak, stopSpeaking, ttsSupported } from '../shared/voice/tts'

export default function VoiceSettings() {
  const settings = useSettings()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null)
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [rate, setRate] = useState<number | null>(null)
  const [pause, setPause] = useState<number | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)

  useEffect(() => {
    void listPortugueseVoices().then(setVoices)
    const loadMics = () => {
      void navigator.mediaDevices
        ?.enumerateDevices()
        .then((d) => setMics(d.filter((x) => x.kind === 'audioinput')))
        .catch(() => setMics([]))
    }
    loadMics()
    navigator.mediaDevices?.addEventListener('devicechange', loadMics)
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', loadMics)
      stopSpeaking()
    }
  }, [])

  useEffect(() => {
    if (settings && rate === null) setRate(settings.ttsRate)
    if (settings && pause === null) setPause(settings.convPauseMs)
  }, [settings, rate, pause])

  if (!settings) return null
  const update = (patch: Parameters<typeof window.api.settings.update>[0]) => void window.api.settings.update(patch)
  const hasLabels = mics.some((m) => m.label)

  async function test() {
    if (speaking) {
      stopSpeaking()
      setSpeaking(false)
      return
    }
    setTestError(null)
    const r = await speak('Olá! Eu sou o QUETI, o seu assistente. Esta é a minha voz.', {
      voiceURI: settings!.ttsVoiceURI,
      rate: rate ?? settings!.ttsRate,
      onEnd: () => setSpeaking(false)
    })
    if (r.ok) setSpeaking(true)
    else setTestError(r.error)
  }

  return (
    <section className="card" aria-labelledby="voice-title">
      <h3 id="voice-title">Voz</h3>

      <h4 className="subhead">Falar com o assistente (microfone)</h4>
      <p className="hint">
        O microfone só liga quando você clica no botão do microfone e desliga ao parar (ou após 2 minutos). Não existe escuta contínua. A
        transcrição usa o Whisper da Groq: o áudio é enviado pela internet e não fica salvo no seu computador. Valores de referência
        da Groq (outubro de 2026): 20 pedidos por minuto, 2.000 por dia, 7.200 segundos de áudio por hora e 28.800 por dia, com mínimo de 10
        segundos de áudio contados por pedido. Confira os limites exatos da sua conta em console.groq.com/settings/limits.
      </p>
      <p>
        Envio de áudio à Groq: <strong>{settings.voiceConsent ? 'permitido' : 'ainda não permitido'}</strong>{' '}
        {settings.voiceConsent ? (
          <button type="button" className="text-btn text-btn--small" onClick={() => update({ voiceConsent: false })}>
            Revogar permissão
          </button>
        ) : (
          <span className="hint">(será pedido na primeira gravação)</span>
        )}
      </p>
      <div className="row">
        <label htmlFor="mic">Microfone</label>
        <select id="mic" className="select" value={settings.micDeviceId} onChange={(e) => update({ micDeviceId: e.target.value })}>
          <option value="">Padrão do sistema</option>
          {mics
            .filter((m) => m.deviceId && m.deviceId !== 'default')
            .map((m, i) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || `Microfone ${i + 1}`}
              </option>
            ))}
        </select>
      </div>
      {!hasLabels && <p className="hint">Os nomes dos microfones aparecem depois da primeira gravação.</p>}
      <label className="row">
        <input type="checkbox" checked={settings.voiceAutoSend} onChange={(e) => update({ voiceAutoSend: e.target.checked })} />
        Enviar a mensagem automaticamente depois de transcrever
      </label>
      <p className="hint">Desligado, o texto transcrito vai para o campo de mensagem para você revisar antes de enviar.</p>
      <label className="row">
        <input type="checkbox" checked={settings.micAutoGain} onChange={(e) => update({ micAutoGain: e.target.checked })} />
        Controle automático de volume do microfone (gravação por clique)
      </label>
      <p className="hint">
        Se ruídos baixos virarem palavras inventadas (por exemplo, endereços), desligue esta opção. O modo conversa sempre a mantém desligada.
      </p>

      <h4 className="subhead">Modo conversa</h4>
      <p className="hint">
        O botão de ondas, ao lado do microfone, inicia uma conversa por voz: o assistente ouve, espera sua pausa, responde falando e volta a
        ouvir. O microfone só abre depois que você inicia a sessão e fecha ao encerrar, após 90 segundos sem fala, após 20 minutos ou quando a
        janela for ocultada. Enquanto o assistente pensa e fala, o microfone fica silenciado. Só as frases detectadas são enviadas à Groq, e
        cada frase conta no mínimo 10 segundos da cota de áudio.
      </p>
      <div className="row">
        <label htmlFor="pause">Pausa para entender que terminei: {((pause ?? settings.convPauseMs) / 1000).toFixed(1)} s</label>
        <input
          id="pause"
          type="range"
          min={600}
          max={2500}
          step={100}
          value={pause ?? settings.convPauseMs}
          onChange={(e) => setPause(Number(e.target.value))}
          onPointerUp={() => pause !== null && update({ convPauseMs: pause })}
          onKeyUp={() => pause !== null && update({ convPauseMs: pause })}
        />
      </div>
      <p className="hint">Se ela corta você no meio da frase, aumente. Se demora para responder, diminua. Vale para a próxima sessão.</p>
      <div className="row">
        <label htmlFor="bargein">Interromper falando por cima</label>
        <select id="bargein" className="select" value={settings.bargeIn} onChange={(e) => update({ bargeIn: e.target.value as BargeInMode })}>
          <option value="speakers">Com alto-falantes</option>
          <option value="headphones">Com fones de ouvido</option>
          <option value="off">Desligado</option>
        </select>
      </div>
      <p className="hint">
        Enquanto o assistente fala, o microfone fica atento à sua voz. Com alto-falantes, o app mede o eco da voz dele e só interrompe se você
        falar bem mais forte; com fones não há eco, então é mais sensível. Ao detectar, a fala é só pausada: se era ruído, ela continua de onde
        parou. Dizer "pare" ou "chega" apenas interrompe, sem gastar uma resposta da IA. Se interromper sozinho, troque para "Desligado" e use o
        botão Interromper; se não interromper quando você fala, aproxime-se do microfone.
      </p>
      <div className="row">
        <label htmlFor="replylen">Tamanho das respostas no modo conversa</label>
        <select
          id="replylen"
          className="select"
          value={settings.conversationReplies}
          onChange={(e) => update({ conversationReplies: e.target.value as ReplyLength })}
        >
          <option value="short">Curtas (até 3 frases)</option>
          <option value="medium">Médias (até 6 frases)</option>
          <option value="normal">Normais</option>
        </select>
      </div>

      <h4 className="subhead">Ouvir as respostas</h4>
      <p className="hint">Usa as vozes instaladas no Windows, sem internet e sem custo. Nenhum texto é enviado para fora para falar.</p>
      {!ttsSupported() && <p className="hint hint--warn">Este ambiente não suporta leitura em voz alta.</p>}
      <label className="row">
        <input type="checkbox" checked={settings.speakReplies} onChange={(e) => update({ speakReplies: e.target.checked })} />
        Ler as respostas em voz alta automaticamente
      </label>
      <div className="row">
        <label htmlFor="voice">Voz</label>
        <select id="voice" className="select" value={settings.ttsVoiceURI} onChange={(e) => update({ ttsVoiceURI: e.target.value })}>
          <option value="">Automática (português)</option>
          {voices?.map((v) => (
            <option key={v.voiceURI} value={v.voiceURI}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </div>
      {voices && voices.length === 0 && (
        <p className="hint hint--warn" role="alert">
          {NO_VOICE_MESSAGE}
        </p>
      )}
      <div className="row">
        <label htmlFor="rate">Velocidade: {(rate ?? settings.ttsRate).toFixed(1)}×</label>
        <input
          id="rate"
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={rate ?? settings.ttsRate}
          onChange={(e) => setRate(Number(e.target.value))}
          onPointerUp={() => rate !== null && update({ ttsRate: rate })}
          onKeyUp={() => rate !== null && update({ ttsRate: rate })}
        />
      </div>
      <p>
        <button type="button" className="text-btn" onClick={() => void test()} disabled={!ttsSupported()}>
          {speaking ? 'Parar' : 'Testar voz'}
        </button>
      </p>
      {testError && (
        <p className="status-line status-line--error" role="alert">
          {testError}
        </p>
      )}
    </section>
  )
}
