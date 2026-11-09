import type { AudioMetrics, PortInfo } from '../../../shared/domain/types'

const EMPTY_METRICS: AudioMetrics = { rms: 0, low: 0, mid: 0, high: 0, connected: false }

export class AudioAnalyzer {
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private stream: MediaStream | null = null
  private timeData = new Float32Array(2048)
  private frequencyData = new Float32Array(1025)
  private metrics: AudioMetrics = { ...EMPTY_METRICS }
  private lastMs = performance.now()

  async devices(): Promise<PortInfo[]> {
    if (!navigator.mediaDevices) return []
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((device) => device.kind === 'audioinput')
      .map((device) => ({
        id: device.deviceId,
        name: device.label || 'Audio input',
        manufacturer: '',
        state: 'connected'
      }))
  }

  async start(deviceId: string | null): Promise<void> {
    await this.stop()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    })
    const context = new AudioContext({ latencyHint: 'interactive' })
    if (context.state === 'suspended') await context.resume()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0
    source.connect(analyser)
    this.stream = stream
    this.context = context
    this.analyser = analyser
    this.timeData = new Float32Array(analyser.fftSize)
    this.frequencyData = new Float32Array(analyser.frequencyBinCount)
    const track = stream.getAudioTracks()[0]
    if (track) {
      track.addEventListener('ended', () => {
        this.metrics.connected = false
      })
    }
    this.metrics = {
      ...EMPTY_METRICS,
      connected: true,
      deviceLabel: track?.label || 'Audio input'
    }
  }

  update(nowMs = performance.now()): AudioMetrics {
    const analyser = this.analyser
    const context = this.context
    if (!analyser || !context || !this.metrics.connected) return { ...this.metrics }

    analyser.getFloatTimeDomainData(this.timeData)
    analyser.getFloatFrequencyData(this.frequencyData)
    let sum = 0
    for (const sample of this.timeData) sum += sample * sample
    const rawRms = Math.sqrt(sum / this.timeData.length)
    const rawLow = this.bandEnergy(40, 200, context.sampleRate)
    const rawMid = this.bandEnergy(200, 2_000, context.sampleRate)
    const rawHigh = this.bandEnergy(2_000, 10_000, context.sampleRate)
    const dt = Math.min(250, Math.max(0, nowMs - this.lastMs))
    this.lastMs = nowMs
    this.metrics.rms = this.smooth(this.metrics.rms, this.normalize(rawRms, 0.003, 0.35), dt)
    this.metrics.low = this.smooth(this.metrics.low, this.normalize(rawLow, 0.00001, 0.02), dt)
    this.metrics.mid = this.smooth(this.metrics.mid, this.normalize(rawMid, 0.000003, 0.01), dt)
    this.metrics.high = this.smooth(this.metrics.high, this.normalize(rawHigh, 0.000001, 0.004), dt)
    return { ...this.metrics }
  }

  async stop(): Promise<void> {
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.context && this.context.state !== 'closed') await this.context.close()
    this.stream = null
    this.context = null
    this.analyser = null
    this.metrics = { ...EMPTY_METRICS }
  }

  private bandEnergy(minHz: number, maxHz: number, sampleRate: number): number {
    const nyquist = sampleRate / 2
    const minIndex = Math.max(0, Math.floor((minHz / nyquist) * this.frequencyData.length))
    const maxIndex = Math.min(
      this.frequencyData.length - 1,
      Math.ceil((Math.min(maxHz, nyquist) / nyquist) * this.frequencyData.length)
    )
    let sum = 0
    let count = 0
    for (let index = minIndex; index <= maxIndex; index += 1) {
      const decibels = this.frequencyData[index] ?? -160
      sum += 10 ** (decibels / 10)
      count += 1
    }
    return count ? sum / count : 0
  }

  private normalize(value: number, floor: number, ceiling: number): number {
    return Math.min(1, Math.max(0, (value - floor) / Math.max(1e-9, ceiling - floor)))
  }

  private smooth(previous: number, target: number, dtMs: number): number {
    const tau = target > previous ? 20 : 180
    return previous + (target - previous) * (1 - Math.exp(-dtMs / tau))
  }
}
