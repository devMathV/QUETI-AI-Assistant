import { GROQ_SECRET, PROVIDER_LABEL } from './providers'
import { hasSecret, secretsAvailable } from './secrets'
import { DEFAULT_MODEL, getSettings } from './settings'
import { broadcast } from './windows'
import type { AiConfig, AiResult } from '../shared/types'

export function aiConfig(): AiConfig {
  return {
    providerLabel: PROVIDER_LABEL,
    model: getSettings().model,
    defaultModel: DEFAULT_MODEL,
    hasKey: hasSecret(GROQ_SECRET),
    secureStorage: secretsAvailable()
  }
}

export function aiChanged(): AiResult {
  const config = aiConfig()
  broadcast('ai:configChanged', config)
  return { ok: true, config }
}
