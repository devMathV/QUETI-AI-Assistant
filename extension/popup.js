const code = document.querySelector('#code')
const save = document.querySelector('#save')
const copy = document.querySelector('#copy')
const status = document.querySelector('#status')
let connectionTimer = null

function show(message, kind = '') {
  status.textContent = message
  status.className = `status ${kind ? `status--${kind}` : ''}`
}

async function checkConnection(port, token) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/status`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!response.ok) throw new Error('código recusado')
    const info = await response.json()
    if (info.connected) {
      if (connectionTimer) clearInterval(connectionTimer)
      connectionTimer = null
      show('Conectada ao QUETI. A extensão está pronta para ler abas.', 'ok')
    } else {
      show('Código aceito. Aguardando a extensão conectar ao QUETI…')
      if (!connectionTimer) {
        connectionTimer = setInterval(() => void checkConnection(port, token), 2000)
      }
    }
  } catch {
    show('Código salvo, mas o QUETI não aceitou a conexão. Verifique se a ponte está ativada.', 'error')
  }

  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.value)
      show('Código copiado.', 'ok')
    } catch {
      show('Não foi possível copiar o código.', 'error')
    }
  })
}

save.addEventListener('click', () => {
  if (connectionTimer) clearInterval(connectionTimer)
  connectionTimer = null
  const match = code.value.trim().match(/^QUETI-(4783[1-5])-([a-f0-9]{48})$/i)
  if (!match) {
    show('Código inválido. Cole o código completo mostrado pelo QUETI.', 'error')
    return
  }
  chrome.storage.local.set({ port: Number(match[1]), token: match[2].toLowerCase() }, () => {
    if (chrome.runtime.lastError) {
      show(`Não foi possível salvar: ${chrome.runtime.lastError.message}`, 'error')
      return
    }
    show('Código salvo. Verificando conexão…')
    void checkConnection(Number(match[1]), match[2].toLowerCase())
  })
})

chrome.storage.local.get(['port', 'token'], (value) => {
  if (value.port && value.token) {
    code.value = `QUETI-${value.port}-${value.token}`
    void checkConnection(value.port, value.token)
  }
})
