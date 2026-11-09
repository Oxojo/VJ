export const LAYER_IDS = ['L1', 'L2', 'L3'] as const
export type LayerId = (typeof LAYER_IDS)[number]

export type Quantize = 'off' | 'beat' | 'bar' | 'four-bars'
export type BlendMode = 'normal' | 'add' | 'screen'
export type FitMode = 'contain' | 'cover'
export type GeneratorId = 'pulse-circle' | 'offset-grid' | 'moving-lines' | 'gradient-field'
export type QualityProfile = 'standard' | 'light' | 'fallback'

export interface AssetPathSpec {
  relativePath?: string
  absolutePathHint?: string
}

export interface AssetRecord {
  id: string
  name: string
  kind: 'video' | 'image'
  mime: string
  size: number
  modifiedMs: number
  path: AssetPathSpec
  width?: number
  height?: number
  durationSec?: number
  sourceUrl?: string
  author?: string
  licenseName?: string
  licenseUrl?: string
  attributionText?: string
  notes?: string
}

export type SourceSpec =
  | {
      kind: 'video'
      assetId: string
      inSec: number
      outSec: number | null
      loop: boolean
      rate: number
      sync: { mode: 'free' } | { mode: 'tempo'; sourceBpm: number; multiplier: 0.5 | 1 | 2 }
    }
  | { kind: 'image'; assetId: string }
  | { kind: 'generator'; generatorId: GeneratorId; seed: number; params: Record<string, number> }
  | { kind: 'solid'; color: [number, number, number, number] }

export interface ClipRecord {
  id: string
  name: string
  source: SourceSpec
}

export interface EffectConfig {
  id: string
  enabled: boolean
  amount: number
}

export interface LayerConfig {
  id: LayerId
  clipId: string | null
  opacity: number
  blend: BlendMode
  fit: FitMode
  muted: boolean
  effects: EffectConfig[]
}

export interface SlotRecord {
  id: string
  x: number
  y: number
  kind: 'clip' | 'scene'
  targetId: string
}

export interface MacroValues {
  color: number
  motion: number
  distort: number
  reactive: number
  echo: number
}

export interface SceneRecord {
  id: string
  name: string
  layers: LayerConfig[]
  macros: MacroValues
  lookPresetId?: string
}

export interface Modulation {
  id: string
  source: 'rms' | 'low' | 'mid' | 'high' | 'beatPulse'
  target: string
  amount: number
  mode: 'add' | 'multiply'
  envelope:
    | { mode: 'milliseconds'; attackMs: number; releaseMs: number }
    | { mode: 'beats'; attackBeats: number; releaseBeats: number }
}

export interface MidiMapping {
  id: string
  message: 'note' | 'cc'
  channel: number
  number: number
  target: string
  behavior: 'latch' | 'continuous'
}

export interface LookPreset {
  id: string
  name: string
  generatorId: GeneratorId
  macros: MacroValues
  cyclesPerBeat: 0.25 | 0.5 | 1 | 2 | 4
  offset: number
  modulations: Modulation[]
  transitionBeats: 0 | 0.25 | 0.5 | 1 | 2
}

export interface ProjectDefaults {
  bpm: number
  quantize: Quantize
  transitionBeats: 0 | 0.25 | 0.5 | 1 | 2
  quality: QualityProfile
  macros: MacroValues
}

export interface Project {
  schemaVersion: 1
  id: string
  name: string
  assets: AssetRecord[]
  clips: ClipRecord[]
  slots: SlotRecord[]
  scenes: SceneRecord[]
  layers: LayerConfig[]
  mappings: MidiMapping[]
  modulations: Modulation[]
  lookPresets: LookPreset[]
  defaults: ProjectDefaults
}

export interface AudioMetrics {
  rms: number
  low: number
  mid: number
  high: number
  connected: boolean
  deviceLabel?: string
}

export interface PortInfo {
  id: string
  name: string
  manufacturer: string
  state: string
}

export type PrepareState = 'empty' | 'loading' | 'ready' | 'playing' | 'error'

export interface RuntimeLayerState {
  id: LayerId
  activeClipId: string | null
  pendingClipId: string | null
  prepareState: PrepareState
  opacity: number
  blend: BlendMode
  muted: boolean
  error?: string
}

export interface RuntimeSnapshot {
  sequence: number
  nowMs: number
  bpm: number
  beat: number
  barPhase: number
  quantize: Quantize
  blackout: boolean
  freeze: boolean
  masterBrightness: number
  macros: MacroValues
  layers: RuntimeLayerState[]
  audio: AudioMetrics
  audioDevices: PortInfo[]
  midi: {
    connected: boolean
    inputId: string | null
    outputId: string | null
    inputs: PortInfo[]
    outputs: PortInfo[]
    lastMessage?: string
  }
  fps: number
  droppedFrames: number
  warning?: string
}

export interface CommandResult {
  requestId: string
  status: 'applied' | 'pending' | 'rejected'
  message?: string
}

export interface SaveProjectResult {
  canceled: boolean
  path?: string
}

export interface OpenProjectResult {
  canceled: boolean
  path?: string
  project?: Project
}
