import type { Edge } from '../../shared/types'

const bubble = document.getElementById('bubble') as HTMLButtonElement

const applyEdge = (edge: Edge): void => {
  document.body.dataset.edge = edge
}

void window.api.settings.get().then((s) => applyEdge(s.widgetEdge))
window.api.settings.onChanged((s) => applyEdge(s.widgetEdge))
window.api.windows.onCompactVisible((visible) => document.body.classList.toggle('open', visible))

// Clique abre/fecha o chat; arrastar na vertical muda a altura do botão.
// Distinguimos os dois pelo deslocamento do ponteiro (limiar de 4 px).
const DRAG_THRESHOLD = 4
let pointerId = -1
let startY = 0
let dragging = false
let pendingY: number | null = null
let frame = 0

function flush(): void {
  frame = 0
  if (pendingY !== null) {
    window.api.float.dragMove(pendingY)
    pendingY = null
  }
}

bubble.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  pointerId = e.pointerId
  startY = e.screenY
  dragging = false
  bubble.setPointerCapture(e.pointerId)
  window.api.float.dragStart(e.screenY)
})

bubble.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pointerId) return
  if (!dragging && Math.abs(e.screenY - startY) > DRAG_THRESHOLD) {
    dragging = true
    document.body.classList.add('dragging')
  }
  if (dragging) {
    pendingY = e.screenY
    if (!frame) frame = requestAnimationFrame(flush) // no máximo 1 mensagem por quadro
  }
})

function finish(e: PointerEvent, cancelled: boolean): void {
  if (e.pointerId !== pointerId) return
  pointerId = -1
  document.body.classList.remove('dragging')
  if (frame) {
    cancelAnimationFrame(frame)
    flush()
  }
  if (dragging) window.api.float.dragEnd()
  else if (!cancelled) window.api.windows.toggleCompact()
  dragging = false
}

bubble.addEventListener('pointerup', (e) => finish(e, false))
bubble.addEventListener('pointercancel', (e) => finish(e, true))

// Acessibilidade: Enter/Espaço no botão focado.
bubble.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    window.api.windows.toggleCompact()
  }
})
