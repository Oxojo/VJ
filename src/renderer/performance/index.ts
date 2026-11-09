import { PerformanceEngine } from './runtime/engine'

export async function startPerformance(): Promise<void> {
  const api = window.vjPerformance
  const canvas = document.querySelector<HTMLCanvasElement>('#performance-canvas')
  if (!api || !canvas) throw new Error('Performance runtime bridge is unavailable')
  const engine = new PerformanceEngine(canvas, api)
  await engine.start()
  window.addEventListener('beforeunload', () => engine.stop())
}
