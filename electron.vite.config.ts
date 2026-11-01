import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Política de segurança de conteúdo (CSP) aplicada apenas no build de produção.
// No modo "dev" o Vite injeta scripts inline para o hot reload, que uma CSP
// estrita bloquearia. Em produção, só scripts do próprio app são executados.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

function productionCsp(): Plugin {
  return {
    name: 'assistente-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`
      )
    }
  }
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), productionCsp()],
    build: {
      rollupOptions: {
        // Três "páginas" independentes: cada janela carrega só o que precisa.
        input: {
          float: resolve(__dirname, 'src/renderer/float/index.html'),
          compact: resolve(__dirname, 'src/renderer/compact/index.html'),
          main: resolve(__dirname, 'src/renderer/main/index.html')
        }
      }
    }
  }
})
