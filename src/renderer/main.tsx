import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './operator/App'
import { startPerformance } from './performance'
import './styles.css'

const view = new URLSearchParams(window.location.search).get('view')
const root = document.querySelector<HTMLDivElement>('#root')
const canvas = document.querySelector<HTMLCanvasElement>('#performance-canvas')

if (view === 'performance') {
  root?.remove()
  if (canvas) canvas.hidden = false
  void startPerformance().catch((error: unknown) => {
    document.body.innerHTML = `<pre class="fatal-output">${error instanceof Error ? error.message : 'Performance runtime failed'}</pre>`
  })
} else {
  canvas?.remove()
  if (!root) throw new Error('Application root is missing')
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}
