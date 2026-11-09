import type { LayerId, Quantize } from './types'

export interface ScheduledLaunch<T> {
  generation: number
  payload: T
  ready: boolean
  targetBeat: number | null
}

export class LaunchScheduler<T> {
  private generations = new Map<LayerId, number>()
  private pending = new Map<LayerId, ScheduledLaunch<T>>()

  arm(layerId: LayerId, payload: T): number {
    const generation = (this.generations.get(layerId) ?? 0) + 1
    this.generations.set(layerId, generation)
    this.pending.set(layerId, { generation, payload, ready: false, targetBeat: null })
    return generation
  }

  markReady(
    layerId: LayerId,
    generation: number,
    currentBeat: number,
    quantize: Quantize
  ): ScheduledLaunch<T> | null {
    const item = this.pending.get(layerId)
    if (!item || item.generation !== generation) return null
    item.ready = true
    item.targetBeat = quantize === 'off' ? currentBeat : this.boundaryAfter(currentBeat, quantize)
    return item
  }

  takeDue(currentBeat: number): Array<{ layerId: LayerId; launch: ScheduledLaunch<T> }> {
    const due: Array<{ layerId: LayerId; launch: ScheduledLaunch<T> }> = []
    for (const [layerId, item] of this.pending) {
      if (!item.ready || item.targetBeat === null || currentBeat + 1e-9 < item.targetBeat) continue
      due.push({ layerId, launch: item })
      this.pending.delete(layerId)
    }
    return due
  }

  get(layerId: LayerId): ScheduledLaunch<T> | undefined {
    return this.pending.get(layerId)
  }

  cancel(layerId: LayerId | 'all'): void {
    if (layerId === 'all') this.pending.clear()
    else this.pending.delete(layerId)
  }

  private boundaryAfter(currentBeat: number, quantize: Exclude<Quantize, 'off'>): number {
    const size = quantize === 'beat' ? 1 : quantize === 'bar' ? 4 : 16
    return (Math.floor((currentBeat + 1e-9) / size) + 1) * size
  }
}
