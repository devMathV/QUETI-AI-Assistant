import { useEffect, useState } from 'react'
import type { Settings } from '../../shared/types'

export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => {
    let active = true
    const off = window.api.settings.onChanged((s) => active && setSettings(s))
    void window.api.settings.get().then((s) => active && setSettings(s))
    return () => {
      active = false
      off()
    }
  }, [])
  return settings
}
