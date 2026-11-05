import { isAbsolute } from 'node:path'

export type Autonomy = 'explicit' | 'ask'

export interface ExplicitTargets {
  enabled: boolean
  paths: string[]
  sites: string[]
  browserTab: boolean
}

const ACCESS_VERB =
  /\b(?:abra|abrir|leia|ler|veja|ver|mostre|mostrar|liste|listar|analise|analisar|resuma|resumir|revise|revisar|consulte|consultar|verifique|verificar|confira|conferir|carregue|carregar|compare|comparar|extraia|extrair|pesquise|pesquisar|busque|buscar|procure|procurar)\b/iu
const WINDOWS_PATH = /(?:["']([^"']*\\[^"']*)["']|(?<![\w])([a-z]:\\[^\s,;!?]+))/gi
const HTTPS_URL = /https:\/\/[^\s<>"'`]+/gi
const DOMAIN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com\.br|org\.br|net\.br|gov\.br|co\.uk|com|org|net|gov|edu|io|dev|ai|app|me)\b/gi
const BROWSER_TAB = /\baba\s+(?:aberta|atual|do\s+navegador)\b/iu
const CAPABILITY_QUESTION = /^\s*(?:você|voce)\s+(?:consegue|pode|poderia|tem como)\b[\s\S]*\?\s*$/iu

const clean = (value: string): string => value.replace(/[).,;!?]+$/g, '').trim()

export function extractExplicitTargets(text: string, autonomy: Autonomy): ExplicitTargets {
  const empty: ExplicitTargets = { enabled: false, paths: [], sites: [], browserTab: false }
  if (autonomy !== 'explicit' || !ACCESS_VERB.test(text) || CAPABILITY_QUESTION.test(text)) return empty

  const paths = [...text.matchAll(WINDOWS_PATH)]
    .map((m) => clean(m[1] ?? m[2] ?? ''))
    .filter((p) => isAbsolute(p))
  const urls = [...text.matchAll(HTTPS_URL)].map((m) => clean(m[0]).toLowerCase())
  const domains = [...text.matchAll(DOMAIN)].map((m) => clean(m[0]).toLowerCase())
  return {
    enabled: true,
    paths: [...new Set(paths)],
    sites: [...new Set([...urls, ...domains])],
    browserTab: BROWSER_TAB.test(text)
  }
}

export function explicitSiteMatches(target: string, sites: string[]): boolean {
  try {
    const host = new URL(target).hostname.toLowerCase()
    return sites.some((site) => {
      const normalized = site.replace(/^https:\/\//i, '').split('/')[0]
      return normalized === host
    })
  } catch {
    return false
  }
}

export function explicitPathMatches(target: string, paths: string[]): boolean {
  const normalized = target.toLowerCase().replace(/[\\/]+/g, '\\').replace(/\\$/, '')
  return paths.some((path) => {
    const candidate = path.toLowerCase().replace(/[\\/]+/g, '\\').replace(/\\$/, '')
    return normalized === candidate
  })
}
