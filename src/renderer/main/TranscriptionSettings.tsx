import { useEffect, useRef, useState } from 'react'
import type { ModelResult, SttModel } from '../../shared/types'
import { useSettings } from '../shared/useSettings'
import { describeMicTest, runMicTest, type MicTestResult } from '../shared/voice/miclevel'
import { VoiceError, VoiceRecorder } from '../shared/voice/recorder'

const MODELS: { value: SttModel; label: string }[] = [
  { value: 'whisper-large-v3', label: 'large-v3: mais preciso (recomendado)' },
  { value: 'whisper-large-v3-turbo', label: 'large-v3-turbo: mais rápido, um pouco menos preciso' }
]

type CompareState = 'idle' | 'starting' | 'recording' | 'comparing'
const MAX_COMPARE_MS = 15_000

export default function TranscriptionSettings() {
  const settings = useSettings()
  const [vocab, setVocab] = useState<string | null>(null)

  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(-100)
  const [micResult, setMicResult] = useState<MicTestResult | null>(null)
  const [micError, setMicError] = useState<string | null>(null)

  const [compare, setCompareRaw] = useState<CompareState>('idle')
  const [results, setResults] = useState<ModelResult[] | null>(null)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [recorder] = useState(() => new VoiceRecorder())
  const compareRef = useRef<CompareState>('idle')

  function setCompare(next: CompareState) {
    compareRef.current = next
    setCompareRaw(next)
  }

  useEffect(() => {
    if (settings && vocab === null) setVocab(settings.sttVocabulary)
  }, [settings, vocab])

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && compareRef.current === 'recording') {
        recorder.cancel()
        setCompare('idle')
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      recorder.cancel()
    }
  }, [recorder])

  if (!settings) return null
  const update = (patch: Parameters<typeof window.api.settings.update>[0]) => void window.api.settings.update(patch)

  async function testMic() {
    setMicError(null)
    setMicResult(null)
    setTesting(true)
    try {
      await window.api.voice.allowMicTest()
      setMicResult(await runMicTest(settings!.micDeviceId, 8000, setLevel, settings!.micAutoGain))
    } catch (e) {
      setMicError(e instanceof VoiceError ? e.message : 'Não foi possível testar o microfone.')
    }
    setTesting(false)
    setLevel(-100)
  }

  async function startCompare() {
    setCompareError(null)
    setResults(null)
    setCompare('starting')
    const begin = await window.api.voice.begin()
    if (!begin.ok) {
      setCompareError(begin.error)
      setCompare('idle')
      return
    }
    try {
      await recorder.start(settings!.micDeviceId, MAX_COMPARE_MS, () => void finishCompare(), settings!.micAutoGain)
    } catch (e) {
      setCompareError(e instanceof VoiceError ? e.message : 'Não foi possível acessar o microfone.')
      setCompare('idle')
      return
    }
    setCompare('recording')
  }

  async function finishCompare() {
    if (compareRef.current !== 'recording') return
    setCompare('comparing')
    const rec = await recorder.stop()
    if (!rec || rec.durationMs < 700) {
      setCompareError('Não ouvi nada. Fale uma frase inteira antes de parar.')
      setCompare('idle')
      return
    }
    if (rec.silent) {
      setCompareError('Não ouvi nenhuma fala. Verifique se o microfone não está mudo ou desligado e tente de novo.')
      setCompare('idle')
      return
    }
    const r = await window.api.voice.compare(rec.data, rec.mimeType)
    if (r.ok) setResults(r.results)
    else setCompareError(r.error)
    setCompare('idle')
  }

  const pct = Math.min(100, Math.max(0, ((level + 80) / 80) * 100))
  const verdict = micResult ? describeMicTest(micResult) : null

  return (
    <section className="card" aria-labelledby="stt-title">
      <h3 id="stt-title">Precisão da transcrição</h3>
      <p className="hint">
        Se o assistente entende errado o que você diz, o erro quase sempre está na transcrição (voz para texto). Estas opções e testes ajudam
        a melhorar e a medir isso.
      </p>

      <div className="row">
        <label htmlFor="stt-model">Modelo</label>
        <select id="stt-model" className="select" value={settings.sttModel} onChange={(e) => update({ sttModel: e.target.value as SttModel })}>
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>
      <p className="hint">Os dois modelos têm os mesmos limites de uso na documentação da Groq, então o mais preciso não gasta mais cota.</p>

      <label className="field-label" htmlFor="stt-vocab">
        Vocabulário (nomes e termos que costumam ser trocados)
      </label>
      <textarea
        id="stt-vocab"
        className="textarea"
        rows={2}
        maxLength={400}
        value={vocab ?? ''}
        onChange={(e) => setVocab(e.target.value)}
        placeholder="Ex.: Electron, TypeScript, Sport, Recife"
      />
      <div className="row">
        <button type="button" className="text-btn" disabled={vocab === settings.sttVocabulary} onClick={() => update({ sttVocabulary: vocab ?? '' })}>
          Salvar vocabulário
        </button>
      </div>
      <p className="hint">Este texto é enviado à Groq junto com o áudio, só para orientar a grafia. Separe por vírgulas e use poucas palavras.</p>
      <label className="row">
        <input type="checkbox" checked={settings.sttUseContext} onChange={(e) => update({ sttUseContext: e.target.checked })} />
        Usar o contexto da conversa para acertar palavras parecidas
      </label>
      <p className="hint">
        Envia à Groq, junto com o áudio, as últimas frases da conversa e os nomes dos arquivos anexados. Ajuda a acertar nomes e termos do assunto.
      </p>

      <h4 className="subhead">Teste do microfone</h4>
      <p className="hint">
        Mede o volume e o ruído, só no seu computador (nada é gravado nem enviado). Fale normalmente por uns 4 segundos e fique em silêncio nos
        outros 4. O teste dura 8 segundos.
      </p>
      <p>
        <button type="button" className="text-btn" onClick={() => void testMic()} disabled={testing}>
          {testing ? 'Medindo…' : 'Testar microfone'}
        </button>
      </p>
      {testing && (
        <div className="meter" role="meter" aria-label="Volume do microfone" aria-valuemin={-80} aria-valuemax={0} aria-valuenow={Math.round(level)}>
          <div className="meter__bar" style={{ width: `${pct}%` }} />
        </div>
      )}
      {verdict && (
        <p className={`status-line status-line--${verdict.ok ? 'ok' : 'error'}`} role="status">
          {verdict.text}
        </p>
      )}
      {micError && (
        <p className="status-line status-line--error" role="alert">
          {micError}
        </p>
      )}

      <h4 className="subhead">Comparar os modelos com a sua voz</h4>
      <p className="hint">
        Grave uma frase (até 15 segundos) e veja como cada modelo a transcreveu. Use frases como as que você diz de verdade, com nomes e termos
        difíceis. Cada comparação envia o áudio à Groq e usa 2 pedidos de transcrição (cada pedido conta no mínimo 10 segundos de áudio na sua cota).
      </p>
      <p>
        {compare === 'recording' ? (
          <button type="button" className="text-btn" onClick={() => void finishCompare()}>
            Parar e comparar
          </button>
        ) : (
          <button type="button" className="text-btn" onClick={() => void startCompare()} disabled={compare !== 'idle'}>
            {compare === 'starting' ? 'Preparando…' : compare === 'comparing' ? 'Comparando…' : 'Gravar frase de teste'}
          </button>
        )}
      </p>
      {compare === 'recording' && (
        <p className="status-line status-line--error" role="status">
          <span className="rec-dot" aria-hidden="true" /> Gravando… fale a frase e clique em “Parar e comparar”.
        </p>
      )}
      {compareError && (
        <p className="status-line status-line--error" role="alert">
          {compareError}
        </p>
      )}
      {results && (
        <ul className="list">
          {results.map((r) => (
            <li key={r.model} className="list__item">
              <div className="list__main">
                <strong>{r.label}</strong>
                <span className={r.ok ? 'list__text' : 'list__text status-line--error'}>{r.ok ? r.text : r.error}</span>
                <span className="hint">{(r.ms / 1000).toFixed(1)} s</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
