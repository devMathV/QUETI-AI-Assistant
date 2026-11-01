import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../shared/styles.css'
import './compact.css'
import Compact from './Compact'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Compact />
  </StrictMode>
)
