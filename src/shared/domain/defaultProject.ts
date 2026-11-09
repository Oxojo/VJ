import type { ClipRecord, LayerConfig, LookPreset, MacroValues, Project, SlotRecord } from './types'

export const DEFAULT_MACROS: MacroValues = {
  color: 0.08,
  motion: 0.45,
  distort: 0.08,
  reactive: 0.5,
  echo: 0.1
}

const layers: LayerConfig[] = [
  { id: 'L1', clipId: null, opacity: 1, blend: 'normal', fit: 'cover', muted: false, effects: [] },
  { id: 'L2', clipId: null, opacity: 0.75, blend: 'screen', fit: 'cover', muted: false, effects: [] },
  { id: 'L3', clipId: null, opacity: 0.8, blend: 'add', fit: 'cover', muted: false, effects: [] }
]

const clips: ClipRecord[] = [
  { id: 'solid-magenta', name: 'Magenta Field', source: { kind: 'solid', color: [0.72, 0.03, 0.3, 1] } },
  { id: 'solid-blue', name: 'Blue Field', source: { kind: 'solid', color: [0.02, 0.12, 0.48, 1] } },
  ...(['pulse-circle', 'offset-grid', 'moving-lines', 'gradient-field'] as const).map((generatorId, index) => ({
    id: `generator-${generatorId}`,
    name: generatorId
      .split('-')
      .map((word) => word[0]?.toUpperCase() + word.slice(1))
      .join(' '),
    source: { kind: 'generator' as const, generatorId, seed: 101 + index, params: {} }
  }))
]

const slots: SlotRecord[] = [
  { id: 'slot-solid-magenta', x: 0, y: 7, kind: 'clip', targetId: 'solid-magenta' },
  { id: 'slot-solid-blue', x: 2, y: 7, kind: 'clip', targetId: 'solid-blue' },
  { id: 'slot-pulse', x: 4, y: 7, kind: 'clip', targetId: 'generator-pulse-circle' },
  { id: 'slot-grid', x: 5, y: 7, kind: 'clip', targetId: 'generator-offset-grid' },
  { id: 'slot-lines', x: 4, y: 6, kind: 'clip', targetId: 'generator-moving-lines' },
  { id: 'slot-gradient', x: 5, y: 6, kind: 'clip', targetId: 'generator-gradient-field' }
]

const lookPresets: LookPreset[] = [
  {
    id: 'look-groove',
    name: 'Groove',
    generatorId: 'pulse-circle',
    macros: { color: 0.08, motion: 0.3, distort: 0.05, reactive: 0.45, echo: 0.16 },
    cyclesPerBeat: 0.5,
    offset: 0,
    modulations: [],
    transitionBeats: 1
  },
  {
    id: 'look-drive',
    name: 'Drive',
    generatorId: 'offset-grid',
    macros: { color: 0.6, motion: 0.72, distort: 0.18, reactive: 0.65, echo: 0.08 },
    cyclesPerBeat: 1,
    offset: 0,
    modulations: [],
    transitionBeats: 0.25
  },
  {
    id: 'look-detail',
    name: 'Detail',
    generatorId: 'moving-lines',
    macros: { color: 0.88, motion: 0.86, distort: 0.25, reactive: 0.78, echo: 0.04 },
    cyclesPerBeat: 4,
    offset: 0,
    modulations: [],
    transitionBeats: 0
  }
]

export function createDefaultProject(projectId = 'project-new'): Project {
  return {
    schemaVersion: 1,
    id: projectId,
    name: 'Untitled VJ Set',
    assets: [],
    clips: structuredClone(clips),
    slots: structuredClone(slots),
    scenes: [],
    layers: structuredClone(layers),
    mappings: [],
    modulations: [
      {
        id: 'mod-low-pulse',
        source: 'low',
        target: 'macros.reactive',
        amount: 0.45,
        mode: 'add',
        envelope: { mode: 'beats', attackBeats: 0.05, releaseBeats: 0.5 }
      }
    ],
    lookPresets: structuredClone(lookPresets),
    defaults: {
      bpm: 130,
      quantize: 'beat',
      transitionBeats: 0.25,
      quality: 'standard',
      macros: { ...DEFAULT_MACROS }
    }
  }
}
