import { BrowserWindow, app, nativeTheme, screen, shell, type Rectangle, type WebContents } from 'electron'
import { join } from 'node:path'
import icon from '../../resources/icon.png?asset'
import { getSettings, updateSettings } from './settings'
import type { MainPage } from '../shared/types'

// ---------------------------------------------------------------------------
// Gerenciamento das três janelas:
//   float   -> botão circular encaixado na borda (sempre visível, minúsculo)
//   compact -> chat rápido ao lado do botão (criado sob demanda)
//   main    -> aplicativo central (criado sob demanda, destruído ao fechar)
// ---------------------------------------------------------------------------

const FLOAT_SIZE = 64
const COMPACT_W = 400
const COMPACT_H = 520
// Distância entre a base da janela compacta e o centro da bolinha (alinha a "setinha").
const COMPACT_TAIL_FROM_BOTTOM = 80
// Libera a RAM da janela compacta depois de um tempo oculta. A conversa não se perde:
// ela vive no processo principal.
const COMPACT_IDLE_DESTROY_MS = 5 * 60 * 1000

let floatWin: BrowserWindow | null = null
let compactWin: BrowserWindow | null = null
let mainWin: BrowserWindow | null = null
let compactPinned = false
let compactAutoHideSuspended = false
let lastBlurHideAt = 0
let idleTimer: NodeJS.Timeout | null = null
let dragStartWinY = 0
let dragStartPointerY = 0

const readyWindows = new WeakSet<BrowserWindow>()
const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined

const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), Math.max(min, max))

// --- utilidades -------------------------------------------------------------

function webPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true, // o código da página não enxerga o preload
    nodeIntegration: false, // a página não tem acesso ao Node
    sandbox: true,
    spellcheck: false
  }
}

function openExternalSafe(url: string): void {
  try {
    if (new URL(url).protocol === 'https:') void shell.openExternal(url)
  } catch {
    // URL inválida: ignorar.
  }
}

function hardenWindow(win: BrowserWindow): void {
  // Nenhuma janela nova é aberta por conteúdo da página; links externos só via https no navegador padrão.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  // Bloqueia navegação para fora da página atual.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })
}

function loadPage(win: BrowserWindow, page: 'float' | 'compact' | 'main', hash?: string): void {
  if (devUrl) {
    void win.loadURL(`${devUrl}/${page}/index.html${hash ? `#${hash}` : ''}`)
  } else {
    void win.loadFile(join(__dirname, '../renderer', page, 'index.html'), hash ? { hash } : undefined)
  }
}

function trackReady(win: BrowserWindow): void {
  win.once('ready-to-show', () => readyWindows.add(win))
}

function whenReady(win: BrowserWindow, cb: () => void): void {
  if (readyWindows.has(win)) cb()
  else win.once('ready-to-show', cb)
}

const alive = (win: BrowserWindow | null): win is BrowserWindow => !!win && !win.isDestroyed()

export function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

/** Usado pelo IPC: só aceitamos mensagens vindas das nossas próprias janelas. */
export function isOurWebContents(wc: WebContents): boolean {
  return [floatWin, compactWin, mainWin].some((w) => alive(w) && w.webContents === wc)
}

// --- geometria ---------------------------------------------------------------

function floatBounds(): Rectangle {
  const s = getSettings()
  const wa = screen.getPrimaryDisplay().workArea
  const wantedY = s.widgetY ?? Math.round(wa.y + wa.height / 2 - FLOAT_SIZE / 2)
  return {
    x: s.widgetEdge === 'left' ? wa.x : wa.x + wa.width - FLOAT_SIZE,
    y: clamp(wantedY, wa.y, wa.y + wa.height - FLOAT_SIZE),
    width: FLOAT_SIZE,
    height: FLOAT_SIZE
  }
}

function compactBounds(): Rectangle {
  const s = getSettings()
  const f = floatBounds()
  const wa = screen.getPrimaryDisplay().workArea
  const height = Math.min(COMPACT_H, wa.height)
  const x = s.widgetEdge === 'left' ? f.x + FLOAT_SIZE + 4 : f.x - COMPACT_W - 4
  const centerY = f.y + FLOAT_SIZE / 2
  return {
    x: clamp(x, wa.x, wa.x + wa.width - COMPACT_W),
    y: clamp(Math.round(centerY - height + COMPACT_TAIL_FROM_BOTTOM), wa.y, wa.y + wa.height - height),
    width: COMPACT_W,
    height
  }
}

export function applyFloatPosition(): void {
  if (alive(floatWin)) floatWin.setBounds(floatBounds())
  if (alive(compactWin) && compactWin.isVisible()) compactWin.setBounds(compactBounds())
}

// --- botão flutuante ---------------------------------------------------------

function ensureFloat(): BrowserWindow {
  if (alive(floatWin)) return floatWin
  const win = new BrowserWindow({
    ...floatBounds(),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Não rouba o foco do aplicativo em que você está trabalhando ao clicar na bolinha.
    focusable: false,
    webPreferences: webPreferences()
  })
  hardenWindow(win)
  trackReady(win)
  win.on('closed', () => {
    floatWin = null
  })
  loadPage(win, 'float')
  floatWin = win
  return win
}

export function showFloat(): void {
  const win = ensureFloat()
  win.setBounds(floatBounds())
  whenReady(win, () => win.showInactive())
}

export function hideFloat(): void {
  if (alive(floatWin)) floatWin.hide()
}

export function floatDragStart(pointerScreenY: number): void {
  if (!alive(floatWin)) return
  dragStartWinY = floatWin.getBounds().y
  dragStartPointerY = pointerScreenY
}

export function floatDragMove(pointerScreenY: number): void {
  if (!alive(floatWin)) return
  const wa = screen.getPrimaryDisplay().workArea
  const y = clamp(dragStartWinY + (pointerScreenY - dragStartPointerY), wa.y, wa.y + wa.height - FLOAT_SIZE)
  floatWin.setBounds({ ...floatWin.getBounds(), y })
}

export function floatDragEnd(): void {
  if (!alive(floatWin)) return
  updateSettings({ widgetY: floatWin.getBounds().y })
  if (alive(compactWin) && compactWin.isVisible()) compactWin.setBounds(compactBounds())
}

// --- janela compacta ---------------------------------------------------------

function clearIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
}

function scheduleIdleDestroy(): void {
  clearIdleTimer()
  idleTimer = setTimeout(() => {
    if (alive(compactWin) && !compactWin.isVisible()) compactWin.destroy()
  }, COMPACT_IDLE_DESTROY_MS)
  idleTimer.unref()
}

function ensureCompact(): BrowserWindow {
  if (alive(compactWin)) return compactWin
  compactPinned = false
  const win = new BrowserWindow({
    ...compactBounds(),
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: webPreferences()
  })
  hardenWindow(win)
  trackReady(win)
  // Clicar fora fecha, a menos que o usuário tenha "fixado" a janela.
  win.on('blur', () => {
    if (!compactPinned && !compactAutoHideSuspended && win.isVisible()) {
      lastBlurHideAt = Date.now()
      hideCompact()
    }
  })
  win.on('closed', () => {
    compactWin = null
  })
  loadPage(win, 'compact')
  compactWin = win
  return win
}

export function showCompact(): void {
  clearIdleTimer()
  const win = ensureCompact()
  win.setBounds(compactBounds())
  whenReady(win, () => {
    win.show()
    win.focus()
    broadcast('compact:visible', true)
  })
}

export function hideCompact(): void {
  if (!alive(compactWin) || !compactWin.isVisible()) return
  compactWin.hide()
  broadcast('compact:visible', false)
  scheduleIdleDestroy()
}

export function toggleCompact(): void {
  if (alive(compactWin) && compactWin.isVisible()) return hideCompact()
  // Se a janela acabou de fechar por perder o foco (o clique que a fechou foi
  // justamente neste botão), não a reabrimos.
  if (Date.now() - lastBlurHideAt < 250) return
  showCompact()
}

/** Evita que o chat rápido feche por perder o foco (ex.: enquanto um diálogo nativo está aberto). */
export function setCompactAutoHideSuspended(suspended: boolean): void {
  compactAutoHideSuspended = suspended
}

export function setCompactPinned(pinned: boolean): void {
  compactPinned = pinned
  // Fixada = sempre por cima, para continuar visível enquanto você usa outro programa.
  if (alive(compactWin)) compactWin.setAlwaysOnTop(pinned)
}

// --- janela principal --------------------------------------------------------

export function openMain(page?: MainPage): void {
  hideCompact()
  if (alive(mainWin)) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.show()
    mainWin.focus()
    if (page) mainWin.webContents.send('main:navigate', page)
    return
  }
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Assistente',
    icon,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1f' : '#ffffff',
    webPreferences: webPreferences()
  })
  hardenWindow(win)
  trackReady(win)
  win.once('ready-to-show', () => win.show())
  // Fechar a janela principal a destrói (libera RAM) e NÃO encerra o aplicativo.
  win.on('closed', () => {
    mainWin = null
  })
  loadPage(win, 'main', page)
  mainWin = win
}

// --- ciclo de vida -----------------------------------------------------------

export function isFloatVisible(): boolean {
  return alive(floatWin) && floatWin.isVisible()
}

/** Aplica as configurações atuais (visibilidade, lado, posição). */
export function applySettingsEffects(): void {
  if (getSettings().widgetEnabled) showFloat()
  else hideFloat()
  applyFloatPosition()
}

export function initWindows(): void {
  screen.on('display-metrics-changed', applyFloatPosition)
  screen.on('display-added', applyFloatPosition)
  screen.on('display-removed', applyFloatPosition)
}
