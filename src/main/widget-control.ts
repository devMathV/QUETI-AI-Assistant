import { applySettingsEffects, broadcast } from './windows'
import { updateSettings } from './settings'
import type { Settings, SettingsPatch } from '../shared/types'

// Ponto único para alterar configurações do botão e refletir isso em todo o app.
// Quem precisar reagir (ex.: a bandeja) se inscreve com onSettingsApplied,
// evitando importações circulares entre módulos.

const listeners = new Set<(s: Settings) => void>()

export function onSettingsApplied(cb: (s: Settings) => void): void {
  listeners.add(cb)
}

export function applySettingsPatch(patch: SettingsPatch): Settings {
  const next = updateSettings(patch)
  applySettingsEffects()
  broadcast('settings:changed', next)
  listeners.forEach((cb) => cb(next))
  return next
}

export function setWidgetEnabled(enabled: boolean): void {
  applySettingsPatch({ widgetEnabled: enabled })
}
