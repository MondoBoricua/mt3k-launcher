import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'
import { applyTextScale, readCachedTextScale } from './lib/textScalePreference'

applyTextScale(readCachedTextScale())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
