import { coordinatesToPadNote, normalizeCc, padNoteToCoordinates, PickupController } from '../../../shared/domain/midi'
import type { LayerId, PortInfo, RuntimeSnapshot } from '../../../shared/domain/types'

export interface ApcActions {
  launchSlot(x: number, y: number): void
  setParameter(path: string, value: number): void
  toggleMute(layerId: LayerId): void
  cancelPending(layerId: LayerId | 'all'): void
  retrigger(layerId: LayerId): void
  stopLayer(layerId: LayerId): void
  tapTempo(): void
  downbeat(): void
  nudge(beats: number): void
  cycleQuantize(): void
  toggleFreeze(): void
  toggleBlackout(): void
  getParameter(path: string): number
}

const FADER_PATHS = [
  'layers.L1.opacity',
  'layers.L2.opacity',
  'layers.L3.opacity',
  'macros.color',
  'macros.motion',
  'macros.distort',
  'macros.reactive',
  'macros.echo',
  'masterBrightness'
] as const

export class ApcMiniController {
  private access: MIDIAccess | null = null
  private input: MIDIInput | null = null
  private output: MIDIOutput | null = null
  private lastMessage = ''
  private selectedLayer: LayerId = 'L1'
  private pickups = FADER_PATHS.map(() => new PickupController())
  private ledQueue = new Map<number, number>()
  private lastLed = new Map<number, number>()
  private ledTimer: number | null = null

  constructor(private readonly actions: ApcActions) {}

  async initialize(): Promise<void> {
    if (!navigator.requestMIDIAccess) return
    this.access = await navigator.requestMIDIAccess({ sysex: false })
    this.access.addEventListener('statechange', () => void this.handleStateChange())
    await this.autoSelect()
  }

  async refresh(): Promise<void> {
    if (!this.access) await this.initialize()
    else await this.autoSelect()
  }

  select(inputId: string | null, outputId: string | null): void {
    if (!this.access) return
    if (this.input) this.input.onmidimessage = null
    this.input = inputId ? (this.access.inputs.get(inputId) ?? null) : null
    this.output = outputId ? (this.access.outputs.get(outputId) ?? null) : null
    if (this.input) this.input.onmidimessage = (event) => this.onMessage(event)
    this.rearmPickups()
    this.resendLeds()
  }

  rearmPickups(): void {
    this.pickups.forEach((pickup, index) => pickup.setTarget(this.actions.getParameter(FADER_PATHS[index] ?? 'masterBrightness')))
  }

  ports(): { inputs: PortInfo[]; outputs: PortInfo[] } {
    const mapPort = (port: MIDIInput | MIDIOutput): PortInfo => ({
      id: port.id,
      name: port.name ?? 'MIDI port',
      manufacturer: port.manufacturer ?? '',
      state: port.state
    })
    return {
      inputs: this.access ? Array.from(this.access.inputs.values(), mapPort) : [],
      outputs: this.access ? Array.from(this.access.outputs.values(), mapPort) : []
    }
  }

  status(): { connected: boolean; inputId: string | null; outputId: string | null; lastMessage?: string } {
    return {
      connected: this.input?.state === 'connected',
      inputId: this.input?.id ?? null,
      outputId: this.output?.id ?? null,
      lastMessage: this.lastMessage || undefined
    }
  }

  updateLeds(snapshot: RuntimeSnapshot, slotTargets: Map<string, string>): void {
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const target = slotTargets.get(`${x}:${y}`)
        let color = target ? (x < 2 ? 13 : x < 4 ? 45 : x < 6 ? 53 : 9) : 0
        const active = snapshot.layers.some((layer) => layer.activeClipId === target)
        const pending = snapshot.layers.some((layer) => layer.pendingClipId === target)
        const failed = snapshot.layers.some((layer) => layer.error && layer.pendingClipId === target)
        if (active) color = 21
        if (pending) color = 5
        if (failed) color = 5
        this.queueLed(coordinatesToPadNote(x, y), color)
      }
    }
  }

  private async autoSelect(): Promise<void> {
    if (!this.access) return
    const inputs = Array.from(this.access.inputs.values()).filter((port) => /apc\s*mini\s*mk2/i.test(port.name ?? ''))
    const outputs = Array.from(this.access.outputs.values()).filter((port) => /apc\s*mini\s*mk2/i.test(port.name ?? ''))
    if (inputs.length === 1 && outputs.length === 1) this.select(inputs[0]?.id ?? null, outputs[0]?.id ?? null)
  }

  private async handleStateChange(): Promise<void> {
    if (this.input?.state === 'disconnected' || this.output?.state === 'disconnected') {
      this.select(null, null)
    }
    await this.autoSelect()
  }

  private onMessage(event: MIDIMessageEvent): void {
    if (!event.data) return
    const [status = 0, data1 = 0, data2 = 0] = Array.from(event.data)
    const kind = status & 0xf0
    const channel = status & 0x0f
    this.lastMessage = `${kind === 0xb0 ? 'CC' : 'Note'} ${data1} · ${data2} · ch ${channel + 1}`

    if (kind === 0xb0 && channel === 0 && data1 >= 48 && data1 <= 56) {
      const index = data1 - 48
      const accepted = this.pickups[index]?.process(normalizeCc(data2))
      const path = FADER_PATHS[index]
      if (accepted !== null && accepted !== undefined && path) this.actions.setParameter(path, accepted)
      return
    }

    if (kind !== 0x90 || data2 === 0) return
    const pad = padNoteToCoordinates(data1)
    if (pad) {
      if (pad.x < 2) this.selectedLayer = 'L1'
      else if (pad.x < 4) this.selectedLayer = 'L2'
      else if (pad.x < 6) this.selectedLayer = 'L3'
      this.actions.launchSlot(pad.x, pad.y)
      return
    }

    if (data1 >= 0x64 && data1 <= 0x66) this.actions.toggleMute((`L${data1 - 0x63}` as LayerId))
    else if (data1 === 0x68) this.actions.cancelPending(this.selectedLayer)
    else if (data1 === 0x69) this.actions.retrigger(this.selectedLayer)
    else if (data1 === 0x6a) this.actions.stopLayer(this.selectedLayer)
    else if (data1 === 0x6b) this.actions.cancelPending('all')
    else if (data1 === 0x70) this.actions.tapTempo()
    else if (data1 === 0x71) this.actions.downbeat()
    else if (data1 === 0x72) this.actions.nudge(-0.05)
    else if (data1 === 0x73) this.actions.nudge(0.05)
    else if (data1 === 0x74) this.actions.cycleQuantize()
    else if (data1 === 0x76) this.actions.toggleFreeze()
    else if (data1 === 0x77) this.actions.toggleBlackout()
  }

  private queueLed(note: number, color: number): void {
    if (this.lastLed.get(note) === color || this.ledQueue.get(note) === color) return
    this.ledQueue.set(note, color)
    if (this.ledTimer === null) this.ledTimer = window.setInterval(() => this.flushLed(), 17)
  }

  private flushLed(): void {
    const next = this.ledQueue.entries().next()
    if (next.done) {
      if (this.ledTimer !== null) window.clearInterval(this.ledTimer)
      this.ledTimer = null
      return
    }
    const [note, color] = next.value
    this.ledQueue.delete(note)
    this.output?.send([0x96, note, color])
    this.lastLed.set(note, color)
  }

  private resendLeds(): void {
    this.ledQueue.clear()
    this.lastLed.clear()
    for (let note = 0; note < 64; note += 1) this.queueLed(note, 0)
  }
}
