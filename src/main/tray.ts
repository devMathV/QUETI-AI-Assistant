import { Menu, Tray, nativeImage } from 'electron'
import icon from '../../resources/icon.png?asset'
import { getSettings } from './settings'
import { openMain, toggleCompact } from './windows'
import { onSettingsApplied, setWidgetEnabled } from './widget-control'
import { quitApp } from './lifecycle'

let tray: Tray | null = null

function buildMenu(): Menu {
  const enabled = getSettings().widgetEnabled
  return Menu.buildFromTemplate([
    { label: 'Abrir aplicativo', click: () => openMain('chat') },
    { label: 'Abrir chat rápido', click: () => toggleCompact() },
    { label: enabled ? 'Ocultar botão flutuante' : 'Mostrar botão flutuante', click: () => setWidgetEnabled(!enabled) },
    { label: 'Configurações', click: () => openMain('settings') },
    { type: 'separator' },
    { label: 'Sair', click: () => quitApp() }
  ])
}

export function createTray(): void {
  const image = nativeImage.createFromPath(icon).resize({ width: 16, height: 16, quality: 'best' })
  tray = new Tray(image)
  tray.setToolTip('QUETI')
  tray.on('click', () => toggleCompact())
  tray.on('double-click', () => openMain('chat'))
  tray.setContextMenu(buildMenu())
  onSettingsApplied(() => refreshTrayMenu())
}

export function refreshTrayMenu(): void {
  tray?.setContextMenu(buildMenu())
}
