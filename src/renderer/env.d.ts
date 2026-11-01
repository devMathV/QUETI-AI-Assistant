/// <reference types="vite/client" />
import type { AssistantApi } from '../shared/types'

declare global {
  interface Window {
    api: AssistantApi
  }
}

export {}
