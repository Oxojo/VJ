import type { Modulation } from './types'

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

export function envelopeTauMs(
  envelope: Modulation['envelope'],
  direction: 'attack' | 'release',
  bpm: number
): number {
  if (envelope.mode === 'milliseconds') {
    return direction === 'attack' ? envelope.attackMs : envelope.releaseMs
  }
  const beats = direction === 'attack' ? envelope.attackBeats : envelope.releaseBeats
  return (60_000 / bpm) * beats
}

export class EnvelopeFollower {
  value = 0

  update(target: number, dtMs: number, bpm: number, envelope: Modulation['envelope']): number {
    const direction = target > this.value ? 'attack' : 'release'
    const tauMs = envelopeTauMs(envelope, direction, bpm)
    if (tauMs === 0) this.value = target
    else this.value += (target - this.value) * (1 - Math.exp(-Math.max(0, dtMs) / tauMs))
    this.value = clamp(this.value)
    return this.value
  }
}

export function applyModulation(base: number, values: Array<{ value: number; amount: number }>): number {
  const delta = values.reduce((sum, item) => sum + item.value * item.amount, 0)
  return clamp(base + delta)
}
