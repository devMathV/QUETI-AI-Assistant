import { randomUUID } from 'node:crypto'
import { createConversation, loadMessages, saveMessage } from './history'
import { getSettings } from './settings'
import type { ChatAction, ChatMessage, ChatRole, Source } from '../shared/types'

const MAX_MESSAGES = 500
const GREETING = 'Do que precisa?'

const STREAM_NOTIFY_MS = 60

let messages: ChatMessage[] = []
let currentConversationId: string | null = null
const listeners = new Set<(messages: ChatMessage[]) => void>()
const historyListeners = new Set<() => void>()
let timer: NodeJS.Timeout | null = null

function notify(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const snapshot = getHistory()
  listeners.forEach((cb) => cb(snapshot))
}

function notifyThrottled(): void {
  if (timer) return
  timer = setTimeout(notify, STREAM_NOTIFY_MS)
}

export const notifyHistoryChanged = (): void => historyListeners.forEach((cb) => cb())
export function onHistoryChanged(cb: () => void): void {
  historyListeners.add(cb)
}

export function addMessage(role: ChatRole, text: string, action?: ChatAction, actionData?: string): string {
  const id = randomUUID()
  messages.push({ id, role, text, ts: Date.now(), ...(action ? { action } : {}), ...(actionData ? { actionData } : {}) })
  if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES)
  notify()
  return id
}

export function setSources(id: string, sources: Source[]): void {
  const i = messages.findIndex((m) => m.id === id)
  if (i < 0) return
  messages[i] = { ...messages[i], sources }
  notifyThrottled()
}

export function setAttachmentNames(id: string, names: string[]): void {
  const i = messages.findIndex((m) => m.id === id)
  if (i < 0) return
  messages[i] = { ...messages[i], attachments: names }
  notify()
}

export function getRecentText(maxChars: number): string {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim().length > 0)
    .slice(-2)
    .map((m) => m.text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/\s+/g, ' ').trim())
    .join(' ')
    .slice(-maxChars)
}

export function appendToMessage(id: string, delta: string): void {
  const i = messages.findIndex((m) => m.id === id)
  if (i < 0) return
  messages[i] = { ...messages[i], text: messages[i].text + delta }
  notifyThrottled()
}

export function flushChat(): void {
  notify()
}

export function persist(id: string): void {
  if (!getSettings().saveHistory) return
  const m = messages.find((x) => x.id === id)
  if (!m || (m.role !== 'user' && m.role !== 'assistant')) return
  try {
    if (!currentConversationId) {
      const title = m.text.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Conversa'
      currentConversationId = createConversation(title)
      if (!currentConversationId) return
    }
    saveMessage(currentConversationId, m)
    notifyHistoryChanged()
  } catch (error) {
    console.error('Falha ao salvar a mensagem:', error)
  }
}

export function newConversation(): void {
  messages = []
  currentConversationId = null
  addMessage('assistant', GREETING)
  notifyHistoryChanged()
}

export function openConversation(id: string): boolean {
  const loaded = loadMessages(id)
  if (!loaded) return false
  messages = loaded
  currentConversationId = id
  notify()
  notifyHistoryChanged()
  return true
}

export const getCurrentConversationId = (): string | null => currentConversationId

export function initChat(): void {
  addMessage('assistant', GREETING)
}

export function getHistory(): ChatMessage[] {
  return [...messages]
}

export function onChatChanged(cb: (messages: ChatMessage[]) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export interface ContextMessage {
  role: 'user' | 'assistant'
  content: string
}

export function getContextMessages(maxChars: number): ContextMessage[] {
  const eligible = messages.filter(
    (m, i): boolean =>
      (m.role === 'user' || m.role === 'assistant') && m.text.trim().length > 0 && !(i === 0 && m.text === GREETING)
  )
  const picked: ContextMessage[] = []
  let used = 0
  for (let i = eligible.length - 1; i >= 0; i--) {
    const m = eligible[i]

    if (picked.length > 0 && used + m.text.length > maxChars) break
    picked.unshift({ role: m.role as 'user' | 'assistant', content: m.text })
    used += m.text.length
  }
  while (picked.length > 0 && picked[0].role === 'assistant') picked.shift()
  return picked
}
