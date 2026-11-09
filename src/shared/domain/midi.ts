export interface PadCoordinates {
  x: number
  y: number
}

export function padNoteToCoordinates(note: number): PadCoordinates | null {
  if (!Number.isInteger(note) || note < 0 || note > 63) return null
  return { x: note % 8, y: 7 - Math.floor(note / 8) }
}

export function coordinatesToPadNote(x: number, y: number): number {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 7 || y < 0 || y > 7) {
    throw new Error('Pad coordinates must be within the 8x8 grid')
  }
  return (7 - y) * 8 + x
}

export function normalizeCc(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(127, Math.max(0, value)) / 127
}

export class PickupController {
  private previous: number | null = null
  private armed = true

  constructor(
    private target = 0,
    private readonly tolerance = 2 / 127
  ) {}

  setTarget(target: number): void {
    this.target = Math.min(1, Math.max(0, target))
    this.previous = null
    this.armed = true
  }

  process(physical: number): number | null {
    const value = Math.min(1, Math.max(0, physical))
    if (!this.armed) {
      this.previous = value
      return value
    }
    const close = Math.abs(value - this.target) <= this.tolerance
    const crossed = this.previous !== null && (this.previous - this.target) * (value - this.target) <= 0
    this.previous = value
    if (!close && !crossed) return null
    this.armed = false
    return value
  }
}
