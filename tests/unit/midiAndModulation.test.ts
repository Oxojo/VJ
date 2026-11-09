import { describe, expect, it } from 'vitest'
import { coordinatesToPadNote, normalizeCc, padNoteToCoordinates, PickupController } from '../../src/shared/domain/midi'
import { applyModulation, EnvelopeFollower, envelopeTauMs } from '../../src/shared/domain/modulation'

describe('APC Mini mappings', () => {
  it('maps the physical bottom row to notes 0–7 and the top row to 56–63', () => {
    expect(coordinatesToPadNote(0, 7)).toBe(0)
    expect(coordinatesToPadNote(7, 0)).toBe(63)
    expect(padNoteToCoordinates(0)).toEqual({ x: 0, y: 7 })
    expect(padNoteToCoordinates(63)).toEqual({ x: 7, y: 0 })
  })

  it('normalizes CC values and waits for pickup crossing', () => {
    expect(normalizeCc(127)).toBe(1)
    const pickup = new PickupController(0.5, 1 / 127)
    expect(pickup.process(0.1)).toBeNull()
    expect(pickup.process(0.495)).toBeCloseTo(0.495)
    expect(pickup.process(0.7)).toBeCloseTo(0.7)
    pickup.setTarget(0.8)
    expect(pickup.process(0.4)).toBeNull()
    expect(pickup.process(0.9)).toBeCloseTo(0.9)
  })
})

describe('modulation envelopes', () => {
  it('converts beat-based release using the current BPM', () => {
    expect(envelopeTauMs({ mode: 'beats', attackBeats: 0.05, releaseBeats: 0.5 }, 'release', 120)).toBe(250)
    expect(envelopeTauMs({ mode: 'beats', attackBeats: 0.05, releaseBeats: 0.5 }, 'release', 300)).toBe(100)
  })

  it('defines zero tau as immediate without division by zero', () => {
    const follower = new EnvelopeFollower()
    expect(follower.update(1, 0, 130, { mode: 'milliseconds', attackMs: 0, releaseMs: 0 })).toBe(1)
    expect(follower.update(0, 0, 130, { mode: 'milliseconds', attackMs: 0, releaseMs: 0 })).toBe(0)
  })

  it('sums modulation before clamping', () => {
    expect(applyModulation(0.7, [{ value: 0.8, amount: 0.5 }, { value: 0.4, amount: -0.25 }])).toBe(1)
  })
})
