import type { Quantize } from './types'

export class BeatClock {
  private anchorMs: number
  private anchorBeat = 0
  private currentBpm: number

  constructor(bpm = 130, nowMs = 0) {
    this.assertBpm(bpm)
    this.currentBpm = bpm
    this.anchorMs = nowMs
  }

  get bpm(): number {
    return this.currentBpm
  }

  beatAt(nowMs: number): number {
    return this.anchorBeat + ((nowMs - this.anchorMs) * this.currentBpm) / 60_000
  }

  setBpm(bpm: number, nowMs: number): void {
    this.assertBpm(bpm)
    this.anchorBeat = this.beatAt(nowMs)
    this.anchorMs = nowMs
    this.currentBpm = bpm
  }

  setDownbeat(nowMs: number): void {
    const current = this.beatAt(nowMs)
    this.anchorBeat = Math.floor(current / 4) * 4
    this.anchorMs = nowMs
  }

  nudge(beats: number): void {
    if (!Number.isFinite(beats)) throw new Error('Nudge must be finite')
    this.anchorBeat += beats
  }

  nextBoundary(quantize: Quantize, nowMs: number): number | null {
    if (quantize === 'off') return null
    const size = quantize === 'beat' ? 1 : quantize === 'bar' ? 4 : 16
    const current = this.beatAt(nowMs)
    return (Math.floor((current + 1e-9) / size) + 1) * size
  }

  private assertBpm(bpm: number): void {
    if (!Number.isFinite(bpm) || bpm < 60 || bpm > 300) {
      throw new Error('BPM must be between 60 and 300')
    }
  }
}

export class TapTempo {
  private taps: number[] = []

  addTap(atMs: number): number | null {
    const last = this.taps.at(-1)
    if (last !== undefined && (atMs <= last || atMs - last >= 2_000)) this.taps = []
    this.taps.push(atMs)
    this.taps = this.taps.slice(-9)
    if (this.taps.length < 3) return null

    const intervals = this.taps
      .slice(1)
      .map((time, index) => time - (this.taps[index] ?? time))
      .filter((interval) => interval >= 200 && interval <= 1_000)
      .slice(-8)
      .sort((a, b) => a - b)

    if (intervals.length < 2) return null
    const middle = Math.floor(intervals.length / 2)
    const median =
      intervals.length % 2 === 0
        ? ((intervals[middle - 1] ?? 0) + (intervals[middle] ?? 0)) / 2
        : (intervals[middle] ?? 0)
    const bpm = 60_000 / median
    return bpm >= 60 && bpm <= 300 ? bpm : null
  }

  reset(): void {
    this.taps = []
  }
}
