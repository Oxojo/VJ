import type { RuntimeCommand } from '../../../shared/commands/runtime'
import { BeatClock, TapTempo } from '../../../shared/domain/beatClock'
import { createDefaultProject } from '../../../shared/domain/defaultProject'
import { LaunchScheduler } from '../../../shared/domain/scheduler'
import type {
  ClipRecord,
  CommandResult,
  LayerConfig,
  LayerId,
  MacroValues,
  PortInfo,
  Project,
  Quantize,
  RuntimeLayerState,
  RuntimeSnapshot,
  SceneRecord
} from '../../../shared/domain/types'
import { parseProject } from '../../../shared/schema/project'
import { AudioAnalyzer } from '../audio/audioAnalyzer'
import type { PreparedSource } from '../media/sourceManager'
import { SourceManager } from '../media/sourceManager'
import { ApcMiniController } from '../midi/apcMini'
import { WebGlRenderer } from '../render/webglRenderer'

interface LaunchPayload {
  requestId: string
  clip: ClipRecord
  prepared: PreparedSource | null
}

interface PendingScene {
  generation: number
  requestId: string
  scene: SceneRecord
  prepared: Map<LayerId, PreparedSource>
  targetBeat: number
}

interface LayerInternalState {
  activeClipId: string | null
  pendingClipId: string | null
  prepareState: RuntimeLayerState['prepareState']
  error?: string
}

const QUANTIZE_ORDER: Quantize[] = ['off', 'beat', 'bar', 'four-bars']
const LAYERS: LayerId[] = ['L1', 'L2', 'L3']

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function layerForX(x: number): LayerId | null {
  if (x <= 1) return 'L1'
  if (x <= 3) return 'L2'
  if (x <= 5) return 'L3'
  return null
}

export class PerformanceEngine {
  private project: Project = createDefaultProject()
  private layers: LayerConfig[] = structuredClone(this.project.layers)
  private layerState = new Map<LayerId, LayerInternalState>()
  private macros: MacroValues = { ...this.project.defaults.macros }
  private masterBrightness = 1
  private blackout = true
  private freeze = false
  private quantize: Quantize = this.project.defaults.quantize
  private clock = new BeatClock(this.project.defaults.bpm, performance.now())
  private readonly taps = new TapTempo()
  private readonly scheduler = new LaunchScheduler<LaunchPayload>()
  private readonly sources = new SourceManager()
  private readonly audio = new AudioAnalyzer()
  private readonly renderer: WebGlRenderer
  private readonly midi: ApcMiniController
  private audioDevices: PortInfo[] = []
  private sequence = 0
  private lastCommandSequence = -1
  private frameRequest = 0
  private lastRenderMs = 0
  private lastSnapshotMs = 0
  private lastPreviewMs = 0
  private fpsWindowMs = performance.now()
  private frameCount = 0
  private fps = 0
  private droppedFrames = 0
  private sceneGeneration = 0
  private pendingScene: PendingScene | null = null
  private warning: string | undefined
  private readonly previewCanvas = document.createElement('canvas')
  private readonly previewContext: CanvasRenderingContext2D

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly api: NonNullable<Window['vjPerformance']>
  ) {
    this.renderer = new WebGlRenderer(canvas)
    this.previewCanvas.width = 320
    this.previewCanvas.height = 180
    const previewContext = this.previewCanvas.getContext('2d', { alpha: false })
    if (!previewContext) throw new Error('Unable to create preview canvas')
    this.previewContext = previewContext
    for (const layerId of LAYERS) this.layerState.set(layerId, this.emptyLayerState())

    this.midi = new ApcMiniController({
      launchSlot: (x, y) => this.launchSlot(x, y, `midi-pad-${x}-${y}`),
      setParameter: (path, value) => this.setParameter(path, value),
      toggleMute: (layerId) => this.toggleMute(layerId),
      cancelPending: (layerId) => this.cancelPending(layerId),
      retrigger: (layerId) => this.sources.retrigger(layerId),
      stopLayer: (layerId) => this.stopLayer(layerId),
      tapTempo: () => this.tapTempo(performance.now()),
      downbeat: () => this.clock.setDownbeat(performance.now()),
      nudge: (beats) => this.clock.nudge(beats),
      cycleQuantize: () => this.cycleQuantize(),
      toggleFreeze: () => this.setFreeze(!this.freeze),
      toggleBlackout: () => {
        this.blackout = !this.blackout
      },
      getParameter: (path) => this.getParameter(path)
    })
  }

  async start(): Promise<void> {
    this.api.onCommand((command) => void this.handleCommand(command))
    document.addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() === 'b' && !(event.target instanceof HTMLInputElement)) {
        this.blackout = !this.blackout
      }
    })
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      this.warning = 'WebGL context lost. Output remains black until recovery.'
      this.blackout = true
    })
    this.canvas.addEventListener('webglcontextrestored', () => window.location.reload())

    await Promise.allSettled([
      this.midi.initialize(),
      this.audio.devices().then((devices) => {
        this.audioDevices = devices
      })
    ])
    this.frameRequest = requestAnimationFrame((now) => this.frame(now))
  }

  stop(): void {
    cancelAnimationFrame(this.frameRequest)
    this.sources.clear()
    void this.audio.stop()
  }

  private async handleCommand(command: RuntimeCommand): Promise<void> {
    if (command.sequence <= this.lastCommandSequence) {
      this.result(command.requestId, 'rejected', 'Stale command sequence')
      return
    }
    this.lastCommandSequence = command.sequence
    try {
      switch (command.type) {
        case 'loadProject':
          this.loadProject(parseProject(command.project))
          this.result(command.requestId, 'applied')
          break
        case 'launchSlot':
          this.launchSlot(command.x, command.y, command.requestId)
          break
        case 'launchScene':
          this.launchScene(command.sceneId, command.requestId)
          break
        case 'cancelPending':
          this.cancelPending(command.layerId)
          this.result(command.requestId, 'applied')
          break
        case 'stopLayer':
          this.stopLayer(command.layerId)
          this.result(command.requestId, 'applied')
          break
        case 'retriggerLayer':
          this.sources.retrigger(command.layerId)
          this.result(command.requestId, 'applied')
          break
        case 'setParameter':
          this.setParameter(command.path, command.value)
          this.result(command.requestId, 'applied')
          break
        case 'setTempo':
          this.clock.setBpm(command.bpm, performance.now())
          this.sources.updateTempo(command.bpm)
          this.result(command.requestId, 'applied')
          break
        case 'tapTempo':
          this.tapTempo(command.atMs ?? performance.now())
          this.result(command.requestId, 'applied')
          break
        case 'halfTempo':
          this.scaleTempo(0.5)
          this.result(command.requestId, 'applied')
          break
        case 'doubleTempo':
          this.scaleTempo(2)
          this.result(command.requestId, 'applied')
          break
        case 'setDownbeat':
          this.clock.setDownbeat(performance.now())
          this.recalculatePendingBoundaries()
          this.result(command.requestId, 'applied')
          break
        case 'nudge':
          this.clock.nudge(command.beats)
          this.result(command.requestId, 'applied')
          break
        case 'setQuantize':
          this.quantize = command.quantize
          this.result(command.requestId, 'applied')
          break
        case 'setBlackout':
          this.blackout = command.enabled
          this.result(command.requestId, 'applied')
          break
        case 'setFreeze':
          this.setFreeze(command.enabled)
          this.result(command.requestId, 'applied')
          break
        case 'setMidiPorts':
          this.midi.select(command.inputId, command.outputId)
          this.result(command.requestId, 'applied')
          break
        case 'refreshMidi':
          await this.midi.refresh()
          this.result(command.requestId, 'applied')
          break
        case 'setAudioDevice':
          if (command.deviceId) await this.audio.start(command.deviceId)
          else await this.audio.stop()
          this.audioDevices = await this.audio.devices()
          this.result(command.requestId, 'applied')
          break
        case 'refreshAudioDevices':
          this.audioDevices = await this.audio.devices()
          this.result(command.requestId, 'applied')
          break
      }
    } catch (error) {
      this.result(command.requestId, 'rejected', error instanceof Error ? error.message : 'Command failed')
    }
  }

  private loadProject(project: Project): void {
    this.cancelPending('all')
    this.sources.clear()
    this.project = project
    this.layers = structuredClone(project.layers)
    this.macros = { ...project.defaults.macros }
    this.quantize = project.defaults.quantize
    this.masterBrightness = 1
    this.blackout = true
    this.setFreeze(false)
    this.clock = new BeatClock(project.defaults.bpm, performance.now())
    this.renderer.setQuality(project.defaults.quality)
    this.renderer.clearHistory()
    for (const layerId of LAYERS) this.layerState.set(layerId, this.emptyLayerState())
    this.midi.rearmPickups()
  }

  private launchSlot(x: number, y: number, requestId: string): void {
    const slot = this.project.slots.find((candidate) => candidate.x === x && candidate.y === y)
    if (!slot) {
      this.result(requestId, 'rejected', 'Empty slot')
      return
    }
    if (slot.kind === 'scene') {
      this.launchScene(slot.targetId, requestId)
      return
    }
    const layerId = layerForX(x)
    const clip = this.project.clips.find((candidate) => candidate.id === slot.targetId)
    if (!layerId || !clip) {
      this.result(requestId, 'rejected', 'Slot target is unavailable')
      return
    }
    if (this.layerState.get(layerId)?.activeClipId === clip.id) {
      this.result(requestId, 'applied', 'Clip already active')
      return
    }
    this.queueClip(layerId, clip, requestId)
  }

  private queueClip(layerId: LayerId, clip: ClipRecord, requestId: string): void {
    this.disposePendingScene()
    const payload: LaunchPayload = { requestId, clip, prepared: null }
    const generation = this.scheduler.arm(layerId, payload)
    this.layerState.set(layerId, {
      activeClipId: this.layerState.get(layerId)?.activeClipId ?? null,
      pendingClipId: clip.id,
      prepareState: 'loading'
    })
    this.result(requestId, 'pending', 'Preparing media')

    void this.sources
      .prepare(clip.source, this.clock.bpm)
      .then((prepared) => {
        const pending = this.scheduler.get(layerId)
        if (!pending || pending.generation !== generation) {
          prepared.dispose()
          return
        }
        payload.prepared = prepared
        const currentBeat = this.clock.beatAt(performance.now())
        this.scheduler.markReady(layerId, generation, currentBeat, this.quantize)
        const current = this.layerState.get(layerId) ?? this.emptyLayerState()
        this.layerState.set(layerId, { ...current, prepareState: 'ready', pendingClipId: clip.id })
      })
      .catch((error: unknown) => {
        const pending = this.scheduler.get(layerId)
        if (!pending || pending.generation !== generation) return
        this.scheduler.cancel(layerId)
        this.layerState.set(layerId, {
          activeClipId: this.layerState.get(layerId)?.activeClipId ?? null,
          pendingClipId: clip.id,
          prepareState: 'error',
          error: error instanceof Error ? error.message : 'Media preparation failed'
        })
        this.result(requestId, 'rejected', error instanceof Error ? error.message : 'Media preparation failed')
      })
  }

  private launchScene(sceneId: string, requestId: string): void {
    const scene = this.project.scenes.find((candidate) => candidate.id === sceneId)
    if (!scene) {
      this.result(requestId, 'rejected', 'Scene not found')
      return
    }
    this.disposePendingScene()
    this.scheduler.cancel('all')
    const generation = ++this.sceneGeneration
    this.result(requestId, 'pending', 'Preparing scene')

    const preparations = scene.layers.map(async (layer) => {
      if (!layer.clipId) return null
      const clip = this.project.clips.find((candidate) => candidate.id === layer.clipId)
      if (!clip) throw new Error(`Scene clip ${layer.clipId} is missing`)
      const prepared = await this.sources.prepare(clip.source, this.clock.bpm)
      return { layerId: layer.id, prepared }
    })
    void Promise.all(preparations)
      .then((items) => {
        if (generation !== this.sceneGeneration) {
          for (const item of items) item?.prepared.dispose()
          return
        }
        const prepared = new Map<LayerId, PreparedSource>()
        for (const item of items) if (item) prepared.set(item.layerId, item.prepared)
        const now = performance.now()
        const targetBeat = this.clock.nextBoundary(this.quantize, now) ?? this.clock.beatAt(now)
        this.pendingScene = { generation, requestId, scene, prepared, targetBeat }
      })
      .catch((error: unknown) => {
        if (generation !== this.sceneGeneration) return
        this.result(requestId, 'rejected', error instanceof Error ? error.message : 'Scene preparation failed')
      })
  }

  private applyDueLaunches(currentBeat: number): void {
    for (const { layerId, launch } of this.scheduler.takeDue(currentBeat)) {
      const prepared = launch.payload.prepared
      if (!prepared) continue
      void this.sources
        .activate(layerId, prepared)
        .then(() => {
          const layer = this.layers.find((candidate) => candidate.id === layerId)
          if (layer) layer.clipId = launch.payload.clip.id
          this.layerState.set(layerId, {
            activeClipId: launch.payload.clip.id,
            pendingClipId: null,
            prepareState: 'playing'
          })
          this.result(launch.payload.requestId, 'applied')
        })
        .catch((error: unknown) => {
          this.layerState.set(layerId, {
            activeClipId: this.layerState.get(layerId)?.activeClipId ?? null,
            pendingClipId: launch.payload.clip.id,
            prepareState: 'error',
            error: error instanceof Error ? error.message : 'Playback failed'
          })
          this.result(launch.payload.requestId, 'rejected', error instanceof Error ? error.message : 'Playback failed')
        })
    }

    const pending = this.pendingScene
    if (!pending || currentBeat + 1e-9 < pending.targetBeat) return
    this.pendingScene = null
    void Promise.all(
      pending.scene.layers.map(async (layer) => {
        const prepared = pending.prepared.get(layer.id)
        if (prepared) await this.sources.activate(layer.id, prepared)
        else this.sources.stop(layer.id)
      })
    )
      .then(() => {
        this.layers = structuredClone(pending.scene.layers)
        this.macros = { ...pending.scene.macros }
        for (const layer of pending.scene.layers) {
          this.layerState.set(layer.id, {
            activeClipId: layer.clipId,
            pendingClipId: null,
            prepareState: layer.clipId ? 'playing' : 'empty'
          })
        }
        this.renderer.clearHistory()
        this.midi.rearmPickups()
        this.result(pending.requestId, 'applied')
      })
      .catch((error: unknown) => {
        this.result(pending.requestId, 'rejected', error instanceof Error ? error.message : 'Scene launch failed')
      })
  }

  private frame(nowMs: number): void {
    const beat = this.clock.beatAt(nowMs)
    this.applyDueLaunches(beat)
    const targetFrameMs = this.renderer.profile === 'fallback' ? 1000 / 30 : 1000 / 60
    const elapsed = nowMs - this.lastRenderMs
    if (elapsed >= targetFrameMs - 1) {
      if (this.lastRenderMs > 0 && elapsed > targetFrameMs * 1.5) this.droppedFrames += Math.max(1, Math.floor(elapsed / targetFrameMs) - 1)
      this.lastRenderMs = nowMs
      const audio = this.audio.update(nowMs)
      this.renderer.render(
        LAYERS.map((layerId) => this.sources.get(layerId)),
        this.layers,
        {
          timeSec: nowMs / 1000,
          beat,
          audio,
          macros: this.macros,
          masterBrightness: this.masterBrightness,
          blackout: this.blackout
        }
      )
      this.frameCount += 1
    }

    if (nowMs - this.fpsWindowMs >= 1000) {
      this.fps = (this.frameCount * 1000) / (nowMs - this.fpsWindowMs)
      this.frameCount = 0
      this.fpsWindowMs = nowMs
    }
    if (nowMs - this.lastSnapshotMs >= 66) {
      this.publishSnapshot(nowMs, beat)
      this.lastSnapshotMs = nowMs
    }
    if (nowMs - this.lastPreviewMs >= 200) {
      this.previewContext.drawImage(this.canvas, 0, 0, 320, 180)
      this.api.publishPreview(this.previewCanvas.toDataURL('image/webp', 0.62))
      this.lastPreviewMs = nowMs
    }
    this.frameRequest = requestAnimationFrame((next) => this.frame(next))
  }

  private publishSnapshot(nowMs: number, beat: number): void {
    const ports = this.midi.ports()
    const midiStatus = this.midi.status()
    const snapshot: RuntimeSnapshot = {
      sequence: ++this.sequence,
      nowMs,
      bpm: this.clock.bpm,
      beat,
      barPhase: ((beat % 4) + 4) % 4 / 4,
      quantize: this.quantize,
      blackout: this.blackout,
      freeze: this.freeze,
      masterBrightness: this.masterBrightness,
      macros: { ...this.macros },
      layers: this.layers.map((layer) => {
        const state = this.layerState.get(layer.id) ?? this.emptyLayerState()
        return {
          id: layer.id,
          activeClipId: state.activeClipId,
          pendingClipId: state.pendingClipId,
          prepareState: state.prepareState,
          opacity: layer.opacity,
          blend: layer.blend,
          muted: layer.muted,
          error: state.error
        }
      }),
      audio: this.audio.update(nowMs),
      audioDevices: this.audioDevices,
      midi: { ...midiStatus, ...ports },
      fps: this.fps,
      droppedFrames: this.droppedFrames,
      warning: this.warning ?? (this.clock.bpm >= 240 && this.renderer.profile === 'fallback' ? 'Fine 1/4-beat pulses may appear coarse at 30 fps.' : undefined)
    }
    this.api.publishSnapshot(snapshot)
    const targets = new Map(this.project.slots.map((slot) => [`${slot.x}:${slot.y}`, slot.targetId]))
    this.midi.updateLeds(snapshot, targets)
  }

  private setParameter(path: string, value: number): void {
    if (path === 'masterBrightness') {
      this.masterBrightness = clamp(value)
      return
    }
    if (path.startsWith('macros.')) {
      const key = path.slice('macros.'.length) as keyof MacroValues
      if (!(key in this.macros)) throw new Error(`Unknown macro ${key}`)
      this.macros[key] = clamp(value)
      return
    }
    const match = /^layers\.(L[1-3])\.(opacity|muted)$/.exec(path)
    if (match) {
      const layer = this.layers.find((candidate) => candidate.id === match[1])
      if (!layer) throw new Error(`Unknown layer ${match[1]}`)
      if (match[2] === 'opacity') layer.opacity = clamp(value)
      else layer.muted = value >= 0.5
      return
    }
    throw new Error(`Unknown parameter path ${path}`)
  }

  private getParameter(path: string): number {
    if (path === 'masterBrightness') return this.masterBrightness
    if (path.startsWith('macros.')) {
      const key = path.slice('macros.'.length) as keyof MacroValues
      return this.macros[key] ?? 0
    }
    const match = /^layers\.(L[1-3])\.opacity$/.exec(path)
    if (match) return this.layers.find((layer) => layer.id === match[1])?.opacity ?? 0
    return 0
  }

  private tapTempo(atMs: number): void {
    const bpm = this.taps.addTap(atMs)
    if (bpm) {
      this.clock.setBpm(bpm, atMs)
      this.sources.updateTempo(bpm)
    }
  }

  private scaleTempo(factor: number): void {
    const bpm = this.clock.bpm * factor
    if (bpm < 60 || bpm > 300) throw new Error('Adjusted BPM is outside 60–300')
    this.clock.setBpm(bpm, performance.now())
    this.sources.updateTempo(bpm)
  }

  private toggleMute(layerId: LayerId): void {
    const layer = this.layers.find((candidate) => candidate.id === layerId)
    if (layer) layer.muted = !layer.muted
  }

  private stopLayer(layerId: LayerId): void {
    this.scheduler.cancel(layerId)
    this.sources.stop(layerId)
    const layer = this.layers.find((candidate) => candidate.id === layerId)
    if (layer) layer.clipId = null
    this.layerState.set(layerId, this.emptyLayerState())
  }

  private cancelPending(layerId: LayerId | 'all'): void {
    this.scheduler.cancel(layerId)
    this.disposePendingScene()
    for (const candidate of LAYERS) {
      if (layerId !== 'all' && candidate !== layerId) continue
      const current = this.layerState.get(candidate) ?? this.emptyLayerState()
      this.layerState.set(candidate, {
        activeClipId: current.activeClipId,
        pendingClipId: null,
        prepareState: current.activeClipId ? 'playing' : 'empty'
      })
    }
  }

  private cycleQuantize(): void {
    const index = QUANTIZE_ORDER.indexOf(this.quantize)
    this.quantize = QUANTIZE_ORDER[(index + 1) % QUANTIZE_ORDER.length] ?? 'off'
  }

  private setFreeze(enabled: boolean): void {
    this.freeze = enabled
    this.renderer.setFreeze(enabled)
  }

  private recalculatePendingBoundaries(): void {
    const now = performance.now()
    const beat = this.clock.beatAt(now)
    for (const layerId of LAYERS) {
      const pending = this.scheduler.get(layerId)
      if (pending?.ready) this.scheduler.markReady(layerId, pending.generation, beat, this.quantize)
    }
    if (this.pendingScene) this.pendingScene.targetBeat = this.clock.nextBoundary(this.quantize, now) ?? beat
  }

  private disposePendingScene(): void {
    this.sceneGeneration += 1
    if (!this.pendingScene) return
    for (const source of this.pendingScene.prepared.values()) source.dispose()
    this.pendingScene = null
  }

  private emptyLayerState(): LayerInternalState {
    return { activeClipId: null, pendingClipId: null, prepareState: 'empty' }
  }

  private result(requestId: string, status: CommandResult['status'], message?: string): void {
    this.api.publishResult({ requestId, status, message })
  }
}
