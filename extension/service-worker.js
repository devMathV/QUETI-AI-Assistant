let config = { port: null, token: null }
let delay = 2000
let polling = false

function loadConfig() {
  chrome.storage.local.get(['port', 'token'], (value) => {
    config = { port: value.port || null, token: value.token || null }
    delay = 2000
    if (config.port && config.token && !polling) poll()
  })
}

async function poll() {
  if (polling) return
  polling = true
  if (!config.port || !config.token) {
    polling = false
    return
  }
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/v1/next`, {
      headers: { Authorization: `Bearer ${config.token}` }
    })
    delay = 2000
    if (response.status === 200) {
      const request = await response.json()
      await execute(request)
    }
  } catch {
    delay = Math.min(delay * 2, 30000)
  }
  polling = false
  if (config.port && config.token) setTimeout(poll, delay)
}

async function execute(request) {
  let result
  try {
    if (request.action === 'list') {
      const tabs = await chrome.tabs.query({ windowType: 'normal' })
      result = { ok: true, data: tabs.slice(0, 40).filter((tab) => /^https?:$/.test(new URL(tab.url || '').protocol)).map((tab) => ({ tabId: tab.id, title: tab.title, url: tab.url })) }
    } else {
      const tabs = await chrome.tabs.query({ windowType: 'normal' })
      const match = typeof request.match === 'string' ? request.match.toLowerCase() : ''
      const candidates = tabs.filter((tab) => /^https?:$/.test(new URL(tab.url || '').protocol))
      const tab = candidates.find((candidate) => !match || `${candidate.title || ''} ${candidate.url || ''}`.toLowerCase().includes(match)) ??
        (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]
      if (!tab?.id || !/^https?:$/.test(new URL(tab.url || '').protocol)) throw new Error('aba não disponível')
      if (request.action === 'info') result = { ok: true, data: { tabId: tab.id, title: tab.title, url: tab.url } }
      else {
        const [{ result: text }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ title: document.title, text: document.body?.innerText?.slice(0, 30000) || '', selection: window.getSelection()?.toString().slice(0, 5000) || '' }) })
        result = { ok: true, data: { ...text, url: tab.url } }
      }
    }
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : 'falha na extensão' }
  }
  await fetch(`http://127.0.0.1:${config.port}/v1/result`, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: request.id, ...result }) })
}

chrome.alarms.create('poll', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(() => poll())
chrome.storage.onChanged.addListener(loadConfig)
loadConfig()
