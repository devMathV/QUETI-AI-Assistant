import { useEffect, useState } from 'react'
import type { AiConfig } from '../../shared/types'

export function useAiConfig(): AiConfig | null {
  const [config, setConfig] = useState<AiConfig | null>(null)
  useEffect(() => {
    let active = true
    const off = window.api.ai.onConfigChanged((c) => active && setConfig(c))
    void window.api.ai.getConfig().then((c) => active && setConfig(c))
    return () => {
      active = false
      off()
    }
  }, [])
  return config
}
