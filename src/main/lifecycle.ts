import { app, globalShortcut } from 'electron'
import { getSettings } from './settings'
import { toggleCompact } from './windows'

let shortcutRegistered = false

export function registerShortcut(): boolean {
  globalShortcut.unregisterAll()
  try {
    shortcutRegistered = globalShortcut.register(getSettings().shortcut, () => toggleCompact())
  } catch {
    shortcutRegistered = false
  }
  return shortcutRegistered
}

export const isShortcutRegistered = (): boolean => shortcutRegistered

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll()
}

/** Encerra o aplicativo por completo (todas as janelas, bandeja e atalho). */
export function quitApp(): void {
  app.quit()
}
