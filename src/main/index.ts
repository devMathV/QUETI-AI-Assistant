import { Menu, app, session } from 'electron'
import { resolve } from 'node:path'
import { initChat } from './chat-store'
import { closeDb, openDb } from './db'
import { purgeByRetention } from './history'
import { registerIpc } from './ipc'
import { registerShortcut, unregisterShortcuts } from './lifecycle'
import { getSettings } from './settings'
import { createTray } from './tray'
import { isMicrophoneAllowed } from './voice'
import { initWindows, isOurWebContents, openMain, showFloat } from './windows'

// Para testar instalações separadas (ou manter um perfil de desenvolvimento
// isolado), defina ASSISTENTE_DATA_DIR com a pasta desejada. Cada pasta tem
// seu próprio banco, configurações e chave de API. Precisa vir antes de qualquer uso de userData.
const customDataDir = process.env['ASSISTENTE_DATA_DIR']
if (customDataDir) app.setPath('userData', resolve(customDataDir))

// Uma única instância por pasta de dados: abrir de novo apenas traz a janela principal para frente.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => openMain('chat'))

  app.whenReady().then(() => {
    app.setAppUserModelId('com.assistente.pessoal')
    if (app.isPackaged) Menu.setApplicationMenu(null) // em "dev" mantemos o menu para usar o DevTools

    // Nega por padrão qualquer permissão de sistema (câmera, localização, etc.).
    // Única exceção: MICROFONE (somente áudio), para as nossas próprias janelas
    // e somente depois de o usuário autorizar o envio de voz (diálogo nativo).
    const audioOnly = (types: readonly string[] | undefined): boolean => !types || types.every((t) => t === 'audio')
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      const types = (details as { mediaTypes?: string[] }).mediaTypes
      callback(permission === 'media' && isOurWebContents(wc) && isMicrophoneAllowed() && audioOnly(types))
    })
    session.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) => {
      const type = (details as { mediaType?: string }).mediaType
      return permission === 'media' && wc !== null && isOurWebContents(wc) && isMicrophoneAllowed() && type !== 'video'
    })

    // Abre o banco já na inicialização (se falhar, o app segue sem salvar e avisa em Privacidade)
    // e aplica a retenção configurada.
    if (openDb()) {
      try {
        purgeByRetention()
      } catch (error) {
        console.error('Falha ao aplicar a retenção:', error)
      }
    }

    initChat()
    registerIpc()
    initWindows()
    createTray()
    registerShortcut()
    if (getSettings().widgetEnabled) showFloat()
  })

  // Fechar todas as janelas NÃO encerra o app: ele continua na bandeja.
  // Para sair de verdade: menu da bandeja → Sair.
  app.on('window-all-closed', () => {})

  app.on('will-quit', () => {
    unregisterShortcuts()
    closeDb()
  })
}
