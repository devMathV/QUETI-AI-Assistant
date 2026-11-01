import { getSecret } from '../secrets'
import { getSettings } from '../settings'
import { OpenAICompatProvider } from './openai-compat'
import type { AIProvider } from './types'

export const GROQ_SECRET = 'groq-api-key'

// A URL do provedor é fixa no código de propósito: se fosse editável, um texto
// malicioso poderia tentar redirecionar a chave de API para outro servidor.
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'

// Limite de resposta: protege a cota gratuita (modelos de raciocínio gastam
// tokens "pensando" antes de responder, por isso o teto não é pequeno).
const MAX_RESPONSE_TOKENS = 1024

export const PROVIDER_LABEL = 'Groq'

export function getProvider(): AIProvider {
  return new OpenAICompatProvider({
    id: 'groq',
    label: PROVIDER_LABEL,
    baseUrl: GROQ_BASE_URL,
    apiKey: getSecret(GROQ_SECRET),
    model: getSettings().model,
    maxTokens: MAX_RESPONSE_TOKENS
  })
}
