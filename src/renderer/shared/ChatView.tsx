import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { BargeInMode, SendMeta } from '../../shared/types'
import { MicIcon, PlusIcon, SendIcon, SpeakerIcon, StopIcon, WaveIcon } from './Icons'
import MessageBody from './MessageBody'
import { useAttachments } from './useAttachments'
import { useChat } from './useChat'
import { useConversation, type ConversationPhase } from './useConversation'
import { useReplySpeaker } from './useReplySpeaker'
import { useSettings } from './useSettings'
import { useSpeech } from './useSpeech'
import { plausibleSpeech } from './voice/plausibility'
import { pauseSpeaking, resumeSpeaking } from './voice/tts'
import { VoiceError, VoiceRecorder } from './voice/recorder'

interface Props {
  variant: 'compact' | 'full'

  focusToken?: number
}

type VoiceState = 'idle' | 'starting' | 'recording' | 'transcribing'
interface Notice {
  text: string
  openSettings: boolean
}
interface SendOptions {
  speak?: boolean
  onSpoken?: () => void
}

const MAX_RECORDING_MS = 120_000
const MIN_RECORDING_MS = 700

const formatTime = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function ChatView({ variant, focusToken = 0 }: Props) {
  const { messages, status, send, cancel } = useChat()
  const settings = useSettings()
  const speech = useSpeech(settings)
  const replySpeaker = useReplySpeaker(messages, status, speech)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [voice, setVoiceRaw] = useState<VoiceState>('idle')
  const [voiceNotice, setVoiceNotice] = useState<Notice | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [recorder] = useState(() => new VoiceRecorder())
  const attachments = useAttachments()
  const [searchNext, setSearchNext] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [attachNotice, setAttachNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!attachNotice) return
    const t = window.setTimeout(() => setAttachNotice(null), 8000)
    return () => window.clearTimeout(t)
  }, [attachNotice])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const voiceRef = useRef<VoiceState>('idle')
  const statusRef = useRef(status)

  const voiceMeta = useRef<{ lowConfidence: boolean } | null>(null)
  const busy = status !== 'idle'
  statusRef.current = status

  function setVoice(next: VoiceState) {
    voiceRef.current = next
    setVoiceRaw(next)
  }

  async function sendText(text: string, meta?: SendMeta, options: SendOptions = {}): Promise<boolean> {
    setError(null)
    stickToBottom.current = true
    speech.stop()

    if (options.speak ?? Boolean(settings?.speakReplies)) replySpeaker.arm(options.onSpoken)
    try {
      await send(text, meta)
      return true
    } catch {
      replySpeaker.cancel()
      setError('Não foi possível enviar. Tente novamente.')
      return false
    }
  }

  const conversation = useConversation({
    settings,
    sendAndWait: (text) =>
      new Promise<boolean>((resolve) => {
        void sendText(text, { fromVoice: true, lowConfidence: false, conversation: true }, { speak: true, onSpoken: () => resolve(true) }).then((ok) => {
          if (!ok) resolve(false)
        })
      }),
    sayLocal: (text) =>
      new Promise<void>((resolve) => {
        void speech.begin('local', resolve).then((session) => {
          if (!session) return resolve()
          session.enqueue(text)
          session.end()
        })
      }),
    assistantSpeaking: speech.speakingId !== null,
    controls: {
      pauseSpeech: pauseSpeaking,
      resumeSpeech: resumeSpeaking,
      abortReply: () => {
        replySpeaker.cancel()
        speech.stop()
        window.api.chat.cancel()
      }
    }
  })

  function stopConversation() {
    conversation.stop()
    replySpeaker.cancel()
    speech.stop()
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [focusToken])

  useEffect(() => {
    const el = logRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages, status])

  function onScroll() {
    const el = logRef.current
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    el.style.overflowY = el.scrollHeight > 120 ? 'auto' : 'hidden'
  }, [draft])

  useEffect(() => {
    if (voice !== 'recording') return
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [voice])

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && voiceRef.current === 'recording') {
        recorder.cancel()
        setVoice('idle')
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      recorder.cancel()
    }
  }, [recorder])

  async function submit() {
    const text = draft.trim()
    if (!text || busy) return
    const meta: SendMeta = {
      ...(voiceMeta.current ? { fromVoice: true, lowConfidence: voiceMeta.current.lowConfidence } : {}),
      ...(searchNext ? { search: true } : {})
    }
    if (await sendText(text, Object.keys(meta).length > 0 ? meta : undefined)) {
      setDraft('')
      voiceMeta.current = null
      setSearchNext(false)
      setAttachNotice(null)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {

    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('.menuwrap')) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  async function attach(kind: 'files' | 'git') {
    setMenuOpen(false)
    const r = kind === 'files' ? await window.api.attachments.pickFiles() : await window.api.attachments.pickGit()
    if (!r.canceled) setAttachNotice(r.message)
    inputRef.current?.focus()
  }

  async function startVoice() {
    setVoiceNotice(null)
    speech.stop()
    setVoice('starting')
    const begin = await window.api.voice.begin()
    if (!begin.ok) {
      setVoiceNotice({ text: begin.error, openSettings: begin.action === 'open-settings' })
      setVoice('idle')
      return
    }

    if (document.hidden) {
      setVoice('idle')
      return
    }
    try {
      await recorder.start(settings?.micDeviceId ?? '', MAX_RECORDING_MS, () => void finishVoice(), settings?.micAutoGain ?? true)
    } catch (e) {
      setVoiceNotice({ text: e instanceof VoiceError ? e.message : 'Não foi possível acessar o microfone.', openSettings: false })
      setVoice('idle')
      return
    }
    setElapsed(0)
    setVoice('recording')
  }

  async function finishVoice() {
    if (voiceRef.current !== 'recording') return
    setVoice('transcribing')
    const rec = await recorder.stop()
    if (!rec || rec.durationMs < MIN_RECORDING_MS) {
      setVoiceNotice({ text: 'Gravação curta demais. Clique no microfone e fale por mais tempo.', openSettings: false })
      setVoice('idle')
      return
    }

    if (rec.silent) {
      setVoiceNotice({
        text: 'Não ouvi nenhuma fala. Verifique se o microfone não está mudo ou desligado (no Windows ou no próprio aparelho) e tente de novo.',
        openSettings: false
      })
      setVoice('idle')
      return
    }
    const result = await window.api.voice.transcribe(rec.data, rec.mimeType)
    if (result.ok) {
      if (!plausibleSpeech(result.text, rec.voicedMs)) {

        setVoiceNotice({ text: 'Descartei o resultado: parecia texto inventado a partir de ruído, não fala. Tente de novo.', openSettings: false })
      } else if (settings?.voiceAutoSend && statusRef.current === 'idle') {
        await sendText(result.text, { fromVoice: true, lowConfidence: result.lowConfidence })
      } else {
        setDraft((d) => (d.trim() ? `${d.trimEnd()} ${result.text}` : result.text))
        voiceMeta.current = { lowConfidence: result.lowConfidence }
        if (result.lowConfidence) {
          setVoiceNotice({ text: 'A transcrição teve baixa confiança. Confira o texto antes de enviar.', openSettings: false })
        }
        inputRef.current?.focus()
      }
    } else if (!result.canceled) {
      setVoiceNotice({ text: result.error, openSettings: result.action === 'open-settings' })
    }
    setVoice('idle')
  }

  function cancelVoice() {
    if (voiceRef.current === 'recording') {
      recorder.cancel()
      setVoice('idle')
    } else if (voiceRef.current === 'transcribing') {
      window.api.voice.cancelTranscription()
    }
  }

  const lastId = messages.length > 0 ? messages[messages.length - 1].id : null
  const micLabel =
    voice === 'recording' ? 'Parar gravação e transcrever' : 'Falar (liga o microfone e envia o áudio à Groq para transcrição)'
  const conversationLabel = conversation.active ? 'Encerrar conversa por voz' : 'Conversar por voz (microfone aberto durante a sessão)'

  const conversationText = (phase: ConversationPhase): string => {
    switch (phase) {
      case 'starting':
        return 'Preparando o microfone…'
      case 'calibrating':
        return 'Ajustando ao ambiente… fique em silêncio.'
      case 'listening':
        return 'Ouvindo. Fale quando quiser.'
      case 'hearing':
        return 'Ouvindo você…'
      case 'transcribing':
        return 'Transcrevendo…'
      default:
        return busy ? (status === 'thinking' ? 'Pensando…' : 'Respondendo…') : 'Falando…'
    }
  }

  return (
    <div className={`chat chat--${variant}`}>
      <div className="chat__log" role="log" aria-live="polite" aria-label="Conversa" ref={logRef} onScroll={onScroll}>
        {messages.map((m) => (
          <div key={m.id} className={`msg msg--${m.role}`}>
            <MessageBody text={m.text} />
            {m.attachments && m.attachments.length > 0 && (
              <div className="msg__files" aria-label="Anexos desta mensagem">
                {m.attachments.map((name) => (
                  <span key={name} className="file-tag" title={name}>
                    📎 {name}
                  </span>
                ))}
              </div>
            )}
            {m.action === 'open-settings' && (
              <button type="button" className="text-btn text-btn--small" onClick={() => window.api.windows.openMain('settings')}>
                Abrir configurações
              </button>
            )}
            {m.action === 'open-memory' && (
              <button type="button" className="text-btn text-btn--small" onClick={() => window.api.windows.openMain('memory')}>
                Ver memória
              </button>
            )}
            {m.action === 'open-permissions' && (
              <button type="button" className="text-btn text-btn--small" onClick={() => window.api.windows.openMain('permissions')}>
                Abrir permissões
              </button>
            )}
            {m.action === 'browser-search' && (
              <button type="button" className="text-btn text-btn--small" onClick={() => window.api.search.openInBrowser(m.actionData ?? '')}>
                Pesquisar no navegador
              </button>
            )}
            {m.sources && m.sources.length > 0 && (
              <ol className="sources" aria-label="Fontes da pesquisa">
                {m.sources.map((s, i) => (
                  <li key={s.url}>
                    <a href={s.url} target="_blank" rel="noreferrer" title={s.url}>
                      [{i + 1}] {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            )}
            {m.role === 'assistant' && speech.supported && !(busy && m.id === lastId) && (
              <div className="msg__tools">
                <button
                  type="button"
                  className="icon-btn icon-btn--small"
                  aria-pressed={speech.speakingId === m.id}
                  aria-label={speech.speakingId === m.id ? 'Parar leitura' : 'Ouvir esta mensagem'}
                  title={speech.speakingId === m.id ? 'Parar leitura' : 'Ouvir esta mensagem'}
                  onClick={() => void speech.speak(m.id, m.text)}
                >
                  {speech.speakingId === m.id ? <StopIcon /> : <SpeakerIcon />}
                </button>
              </div>
            )}
          </div>
        ))}
        {status === 'thinking' && !conversation.active && (
          <div className="msg msg--notice" role="status">
            Pensando…
          </div>
        )}
      </div>

      {error && (
        <p className="chat__error" role="alert">
          {error}
        </p>
      )}
      {speech.error && (
        <p className="chat__error" role="alert">
          {speech.error}
        </p>
      )}

      {conversation.active && (
        <div className="convbar" role="status">
          <div className="convbar__top">
            {(conversation.phase === 'listening' || conversation.phase === 'hearing') && <span className="rec-dot" aria-hidden="true" />}
            <strong
              className="convbar__status"
              title="O áudio só é enviado à Groq quando você fala. Fixe a janela com o alfinete para continuar em outro programa."
            >
              {conversationText(conversation.phase)}
            </strong>
          </div>
          {conversation.notice && <p className="convbar__note">{conversation.notice}</p>}
          <div className="convbar__actions">
            <select
              className="select select--small"
              aria-label="Interromper o assistente falando por cima"
              title="Interromper o assistente falando por cima"
              value={settings?.bargeIn ?? 'speakers'}
              onChange={(e) => void window.api.settings.update({ bargeIn: e.target.value as BargeInMode })}
            >
              <option value="speakers">Alto-falantes</option>
              <option value="headphones">Fones</option>
              <option value="off">Sem interrupção</option>
            </select>
            {conversation.phase === 'answering' && (
              <button type="button" className="text-btn text-btn--small" onClick={conversation.interruptNow}>
                Interromper
              </button>
            )}
            <button type="button" className="text-btn text-btn--small" onClick={stopConversation}>
              Encerrar
            </button>
          </div>
        </div>
      )}
      {!conversation.active && conversation.notice && (
        <div className="voicebar voicebar--error" role="alert">
          <span className="voicebar__text">{conversation.notice}</span>
          <button type="button" className="text-btn text-btn--small" onClick={conversation.clearNotice}>
            Ok
          </button>
        </div>
      )}

      {voice === 'starting' && (
        <div className="voicebar" role="status">
          Preparando o microfone…
        </div>
      )}
      {voice === 'recording' && (
        <div className="voicebar voicebar--rec" role="status">
          <span className="rec-dot" aria-hidden="true" />
          <span className="voicebar__text">
            <strong>Gravando {formatTime(elapsed)}</strong>
            <span className="hint"> · clique no microfone para parar. O áudio será enviado à Groq para virar texto.</span>
          </span>
          <button type="button" className="text-btn text-btn--small" onClick={cancelVoice}>
            Cancelar
          </button>
        </div>
      )}
      {voice === 'transcribing' && (
        <div className="voicebar" role="status">
          <span className="voicebar__text">Transcrevendo…</span>
          <button type="button" className="text-btn text-btn--small" onClick={cancelVoice}>
            Cancelar
          </button>
        </div>
      )}
      {voiceNotice && voice === 'idle' && (
        <div className="voicebar voicebar--error" role="alert">
          <span className="voicebar__text">{voiceNotice.text}</span>
          {voiceNotice.openSettings && (
            <button type="button" className="text-btn text-btn--small" onClick={() => window.api.windows.openMain('settings')}>
              Abrir configurações
            </button>
          )}
        </div>
      )}

      {(searchNext || attachments.length > 0) && (
        <div className="chips-row" aria-label="Contexto da próxima mensagem">
          {searchNext && (
            <span className="chip-tag">
              🌐 Pesquisar na web
              <button type="button" aria-label="Desligar pesquisa na web" onClick={() => setSearchNext(false)}>
                ×
              </button>
            </span>
          )}
          {attachments.map((a) => (
            <span key={a.id} className="chip-tag" title={`${a.name} (${a.chars.toLocaleString('pt-BR')} caracteres)`}>
              {a.kind === 'git' ? '⎇' : '📎'} {a.name}
              <button
                type="button"
                aria-label={`Remover ${a.name}`}
                onClick={() => {
                  void window.api.attachments.remove(a.id)
                  setAttachNotice(null)
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {attachNotice && <p className="hint chat__note">{attachNotice}</p>}

      <div className="chat__composer">
        <div className="menuwrap">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Mais ações: pesquisar na web, anexar arquivos ou Git"
            title="Pesquisar na web, anexar arquivos ou Git"
          >
            <PlusIcon />
          </button>
          {menuOpen && (
            <ul className="menu" role="menu">
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSearchNext((v) => !v)
                    setMenuOpen(false)
                  }}
                >
                  {searchNext ? 'Desligar pesquisa na web' : 'Pesquisar na web (próxima mensagem)'}
                </button>
              </li>
              <li role="none">
                <button type="button" role="menuitem" onClick={() => void attach('files')}>
                  Anexar arquivos…
                </button>
              </li>
              <li role="none">
                <button type="button" role="menuitem" onClick={() => void attach('git')}>
                  Anexar alterações do Git…
                </button>
              </li>
              {attachments.length > 0 && (
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      void window.api.attachments.clear()
                      setAttachNotice(null)
                      setMenuOpen(false)
                    }}
                  >
                    Remover todos os anexos
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          maxLength={8000}
          placeholder={variant === 'compact' ? 'Mensagem' : 'Escreva uma mensagem'}
          aria-label="Mensagem"
          onChange={(e) => {
            setDraft(e.target.value)
            if (!e.target.value.trim()) voiceMeta.current = null
          }}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <button type="button" className="btn" onClick={cancel} aria-label="Parar resposta" title="Parar resposta">
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            className="btn"
            onClick={() => void submit()}
            disabled={!draft.trim()}
            aria-label="Enviar mensagem"
            title="Enviar (Enter)"
          >
            <SendIcon />
          </button>
        )}
        {!conversation.active && (
          <button
            type="button"
            className={`btn ${voice === 'recording' ? 'btn--rec' : ''}`}
            onClick={() => (voice === 'recording' ? void finishVoice() : void startVoice())}
            disabled={voice === 'starting' || voice === 'transcribing' || (busy && voice === 'idle') || conversation.active}
            aria-pressed={voice === 'recording'}
            aria-label={micLabel}
            title={micLabel}
          >
            {voice === 'recording' ? <StopIcon /> : <MicIcon />}
          </button>
        )}
        <button
          type="button"
          className={`btn ${conversation.active ? 'btn--rec' : ''}`}
          onClick={() => (conversation.active ? stopConversation() : void conversation.start())}
          disabled={voice !== 'idle' || (busy && !conversation.active) || conversation.phase === 'starting'}
          aria-pressed={conversation.active}
          aria-label={conversationLabel}
          title={conversationLabel}
        >
          {conversation.active ? <StopIcon /> : <WaveIcon />}
        </button>
      </div>
    </div>
  )
}
