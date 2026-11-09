import { describe, expect, it } from 'vitest'
import { BeatClock, TapTempo } from '../../src/shared/domain/beatClock'

describe('BeatClock', () => {
  it('derives beat position from monotonic time at the supported BPM boundaries', () => {
    const slow = new BeatClock(60, 1_000)
    const fast = new BeatClock(300, 1_000)
    expect(slow.beatAt(2_000)).toBeCloseTo(1)
    expect(fast.beatAt(2_000)).toBeCloseTo(5)
  })

  it('preserves phase when BPM changes', () => {
    const clock = new BeatClock(120, 0)
    expect(clock.beatAt(1_750)).toBeCloseTo(3.5)
    clock.setBpm(180, 1_750)
    expect(clock.beatAt(1_750)).toBeCloseTo(3.5)
    expect(clock.beatAt(2_750)).toBeCloseTo(6.5)
  })

  it('always schedules strictly after a boundary press', () => {
    const clock = new BeatClock(120, 0)
    expect(clock.nextBoundary('beat', 2_000)).toBe(5)
    expect(clock.nextBoundary('bar', 2_000)).toBe(8)
    expect(clock.nextBoundary('four-bars', 8_000)).toBe(32)
    expect(clock.nextBoundary('off', 2_000)).toBeNull()
  })

  it('redefines the current instant as a downbeat', () => {
    const clock = new BeatClock(120, 0)
    clock.setDownbeat(1_750)
    expect(clock.beatAt(1_750) % 4).toBe(0)
    expect(clock.beatAt(2_250) % 4).toBeCloseTo(1)
  })
})

describe('TapTempo', () => {
  it('uses the median of recent valid intervals and resets after a long gap', () => {
    const taps = new TapTempo()
    expect(taps.addTap(0)).toBeNull()
    expect(taps.addTap(500)).toBeNull()
    expect(taps.addTap(1_010)).toBeCloseTo(118.8, 1)
    expect(taps.addTap(1_500)).toBeCloseTo(120, 1)
    expect(taps.addTap(4_000)).toBeNull()
  })
})
