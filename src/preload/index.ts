import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AssistantApi } from '../shared/types'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: AssistantApi = {
  chat: {
    getHistory: () => ipcRenderer.invoke('chat:getHistory'),
    getStatus: () => ipcRenderer.invoke('chat:getStatus'),
    send: (text, meta) => ipcRenderer.invoke('chat:send', text, meta),
    cancel: () => ipcRenderer.send('chat:cancel'),
    newConversation: () => ipcRenderer.send('chat:new'),
    onUpdated: (cb) => subscribe('chat:updated', cb),
    onStatus: (cb) => subscribe('chat:status', cb)
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    open: (id) => ipcRenderer.invoke('history:open', id),
    remove: (id) => ipcRenderer.invoke('history:remove', id),
    onChanged: (cb) => subscribe<void>('history:changed', cb)
  },
  memory: {
    list: () => ipcRenderer.invoke('memory:list'),
    add: (content, always) => ipcRenderer.invoke('memory:add', content, always),
    update: (id, patch) => ipcRenderer.invoke('memory:update', id, patch),
    remove: (id) => ipcRenderer.invoke('memory:remove', id),
    onChanged: (cb) => subscribe<void>('memory:changed', cb)
  },
  data: {
    info: () => ipcRenderer.invoke('data:info'),
    exportAll: () => ipcRenderer.invoke('data:export'),
    deleteHistory: () => ipcRenderer.invoke('data:deleteHistory'),
    deleteMemory: () => ipcRenderer.invoke('data:deleteMemory'),
    deleteEverything: () => ipcRenderer.invoke('data:deleteEverything')
  },
  ai: {
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    setKey: (key) => ipcRenderer.invoke('ai:setKey', key),
    removeKey: () => ipcRenderer.invoke('ai:removeKey'),
    setModel: (model) => ipcRenderer.invoke('ai:setModel', model),
    testConnection: () => ipcRenderer.invoke('ai:testConnection'),
    onConfigChanged: (cb) => subscribe('ai:configChanged', cb)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    onChanged: (cb) => subscribe('settings:changed', cb)
  },
  windows: {
    toggleCompact: () => ipcRenderer.send('windows:toggleCompact'),
    hideCompact: () => ipcRenderer.send('windows:hideCompact'),
    setCompactPinned: (pinned) => ipcRenderer.send('windows:setCompactPinned', pinned),
    openMain: (page) => ipcRenderer.send('windows:openMain', page),
    quit: () => ipcRenderer.send('app:quit'),
    onCompactVisible: (cb) => subscribe('compact:visible', cb),
    onNavigate: (cb) => subscribe('main:navigate', cb)
  },
  float: {
    dragStart: (y) => ipcRenderer.send('float:dragStart', y),
    dragMove: (y) => ipcRenderer.send('float:dragMove', y),
    dragEnd: () => ipcRenderer.send('float:dragEnd')
  },
  voice: {
    begin: () => ipcRenderer.invoke('voice:begin'),
    transcribe: (audio, mimeType) => ipcRenderer.invoke('voice:transcribe', audio, mimeType),
    cancelTranscription: () => ipcRenderer.send('voice:cancel'),
    compare: (audio, mimeType) => ipcRenderer.invoke('voice:compare', audio, mimeType),
    allowMicTest: () => ipcRenderer.invoke('voice:allowMicTest')
  },
  search: {
    getConfig: () => ipcRenderer.invoke('search:getConfig'),
    setKey: (key) => ipcRenderer.invoke('search:setKey', key),
    removeKey: () => ipcRenderer.invoke('search:removeKey'),
    test: () => ipcRenderer.invoke('search:test'),
    openInBrowser: (query) => ipcRenderer.send('search:openBrowser', query),
    onConfigChanged: (cb) => subscribe('search:configChanged', cb)
  },
  permissions: {
    list: () => ipcRenderer.invoke('permissions:list'),
    log: () => ipcRenderer.invoke('permissions:log'),
    addSite: (domain, mode) => ipcRenderer.invoke('permissions:addSite', domain, mode),
    addApp: () => ipcRenderer.invoke('permissions:addApp'),
    addFolder: (mode) => ipcRenderer.invoke('permissions:addFolder', mode),
    revoke: (id) => ipcRenderer.invoke('permissions:revoke', id),
    clearLog: () => ipcRenderer.send('permissions:clearLog'),
    onChanged: (cb) => subscribe<void>('permissions:changed', cb)
    ,browserInfo: () => ipcRenderer.invoke('permissions:browserInfo')
    ,regenerateBrowserCode: () => ipcRenderer.invoke('permissions:regenerateBrowserCode')
  },
  attachments: {
    list: () => ipcRenderer.invoke('attachments:list'),
    pickFiles: () => ipcRenderer.invoke('attachments:pickFiles'),
    pickGit: () => ipcRenderer.invoke('attachments:pickGit'),
    remove: (id) => ipcRenderer.invoke('attachments:remove', id),
    clear: () => ipcRenderer.invoke('attachments:clear'),
    onChanged: (cb) => subscribe('attachments:changed', cb)
  },
  clipboard: {
    copy: (text) => ipcRenderer.send('clipboard:write', text)
  },
  diagnostics: {
    get: () => ipcRenderer.invoke('diagnostics:get')
  }
}

contextBridge.exposeInMainWorld('api', api)
