// Ícones simples em SVG inline: sem biblioteca extra e sem requisições.
const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

export const SendIcon = () => (
  <svg {...base}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
)
export const MicIcon = () => (
  <svg {...base}><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
)
export const PinIcon = () => (
  <svg {...base}><path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 13v8" /></svg>
)
export const ExpandIcon = () => (
  <svg {...base}><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" /></svg>
)
export const CloseIcon = () => (
  <svg {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>
)
export const PlusIcon = () => (
  <svg {...base}><path d="M12 5v14M5 12h14" /></svg>
)
export const StopIcon = () => (
  <svg {...base} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
)
export const SpeakerIcon = () => (
  <svg {...base}><path d="M11 5L6 9H3v6h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></svg>
)
export const WaveIcon = () => (
  <svg {...base}><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M22 12h-1" /></svg>
)
