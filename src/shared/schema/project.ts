import { z } from 'zod'
import type { LayerId, Project, SourceSpec } from '../domain/types'

const finite = z.number().finite()
const unit = finite.min(0).max(1)
const id = z.string().min(1).max(160)
const layerId = z.enum(['L1', 'L2', 'L3'])
const generatorId = z.enum(['pulse-circle', 'offset-grid', 'moving-lines', 'gradient-field'])
const macroSchema = z.object({
  color: unit,
  motion: unit,
  distort: unit,
  reactive: unit,
  echo: unit
})

export const sourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('video'),
    assetId: id,
    inSec: finite.min(0),
    outSec: finite.positive().nullable(),
    loop: z.boolean(),
    rate: finite.positive().max(4),
    sync: z.union([
      z.object({ mode: z.literal('free') }),
      z.object({
        mode: z.literal('tempo'),
        sourceBpm: finite.min(30).max(400),
        multiplier: z.union([z.literal(0.5), z.literal(1), z.literal(2)])
      })
    ])
  }),
  z.object({ kind: z.literal('image'), assetId: id }),
  z.object({
    kind: z.literal('generator'),
    generatorId,
    seed: z.number().int(),
    params: z.record(z.string(), finite)
  }),
  z.object({ kind: z.literal('solid'), color: z.tuple([unit, unit, unit, unit]) })
])

const effectSchema = z.object({ id, enabled: z.boolean(), amount: unit })
export const layerSchema = z.object({
  id: layerId,
  clipId: id.nullable(),
  opacity: unit,
  blend: z.enum(['normal', 'add', 'screen']),
  fit: z.enum(['contain', 'cover']),
  muted: z.boolean(),
  effects: z.array(effectSchema).max(16)
})

const modulationSchema = z.object({
  id,
  source: z.enum(['rms', 'low', 'mid', 'high', 'beatPulse']),
  target: id,
  amount: finite.min(-4).max(4),
  mode: z.enum(['add', 'multiply']),
  envelope: z.union([
    z.object({
      mode: z.literal('milliseconds'),
      attackMs: finite.min(0).max(10000),
      releaseMs: finite.min(0).max(10000)
    }),
    z.object({
      mode: z.literal('beats'),
      attackBeats: finite.min(0).max(16),
      releaseBeats: finite.min(0).max(16)
    })
  ])
})

export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  name: z.string().min(1).max(160),
  assets: z.array(
    z.object({
      id,
      name: z.string().min(1).max(512),
      kind: z.enum(['video', 'image']),
      mime: z.string().min(1),
      size: z.number().int().nonnegative(),
      modifiedMs: finite.nonnegative(),
      path: z.object({
        relativePath: z.string().min(1).optional(),
        absolutePathHint: z.string().min(1).optional()
      }),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      durationSec: finite.positive().optional(),
      sourceUrl: z.url().optional(),
      author: z.string().max(500).optional(),
      licenseName: z.string().max(500).optional(),
      licenseUrl: z.url().optional(),
      attributionText: z.string().max(2000).optional(),
      notes: z.string().max(5000).optional()
    })
  ),
  clips: z.array(z.object({ id, name: z.string().min(1).max(512), source: sourceSchema })),
  slots: z.array(
    z.object({
      id,
      x: z.number().int().min(0).max(7),
      y: z.number().int().min(0).max(7),
      kind: z.enum(['clip', 'scene']),
      targetId: id
    })
  ),
  scenes: z.array(
    z.object({
      id,
      name: z.string().min(1).max(160),
      layers: z.array(layerSchema).length(3),
      macros: macroSchema,
      lookPresetId: id.optional()
    })
  ),
  layers: z.array(layerSchema).length(3),
  mappings: z.array(
    z.object({
      id,
      message: z.enum(['note', 'cc']),
      channel: z.number().int().min(0).max(15),
      number: z.number().int().min(0).max(127),
      target: id,
      behavior: z.enum(['latch', 'continuous'])
    })
  ),
  modulations: z.array(modulationSchema),
  lookPresets: z.array(
    z.object({
      id,
      name: z.string().min(1).max(160),
      generatorId,
      macros: macroSchema,
      cyclesPerBeat: z.union([z.literal(0.25), z.literal(0.5), z.literal(1), z.literal(2), z.literal(4)]),
      offset: finite,
      modulations: z.array(modulationSchema),
      transitionBeats: z.union([
        z.literal(0),
        z.literal(0.25),
        z.literal(0.5),
        z.literal(1),
        z.literal(2)
      ])
    })
  ),
  defaults: z.object({
    bpm: finite.min(60).max(300),
    quantize: z.enum(['off', 'beat', 'bar', 'four-bars']),
    transitionBeats: z.union([
      z.literal(0),
      z.literal(0.25),
      z.literal(0.5),
      z.literal(1),
      z.literal(2)
    ]),
    quality: z.enum(['standard', 'light', 'fallback']),
    macros: macroSchema
  })
})

function layerForSlotX(x: number): LayerId | null {
  if (x <= 1) return 'L1'
  if (x <= 3) return 'L2'
  if (x <= 5) return 'L3'
  return null
}

function sourceAllowed(layer: LayerId, source: SourceSpec): boolean {
  return layer === 'L3' ? source.kind !== 'video' : source.kind !== 'generator'
}

export function parseProject(value: unknown): Project {
  const project = projectSchema.parse(value) as Project
  const assetIds = new Set(project.assets.map((asset) => asset.id))
  const clips = new Map(project.clips.map((clip) => [clip.id, clip]))
  const sceneIds = new Set(project.scenes.map((scene) => scene.id))
  const slotKeys = new Set<string>()

  for (const clip of project.clips) {
    if ((clip.source.kind === 'video' || clip.source.kind === 'image') && !assetIds.has(clip.source.assetId)) {
      throw new Error(`Clip ${clip.id} references missing asset ${clip.source.assetId}`)
    }
  }

  for (const layer of project.layers) {
    if (!layer.clipId) continue
    const clip = clips.get(layer.clipId)
    if (!clip) throw new Error(`Layer ${layer.id} references missing clip ${layer.clipId}`)
    if (!sourceAllowed(layer.id, clip.source)) throw new Error(`${clip.source.kind} is not allowed on ${layer.id}`)
  }

  for (const slot of project.slots) {
    const key = `${slot.x}:${slot.y}`
    if (slotKeys.has(key)) throw new Error(`Duplicate slot position ${key}`)
    slotKeys.add(key)
    if (slot.kind === 'scene') {
      if (slot.x < 6 || !sceneIds.has(slot.targetId)) throw new Error(`Invalid scene slot ${slot.id}`)
      continue
    }
    const clip = clips.get(slot.targetId)
    const layer = layerForSlotX(slot.x)
    if (!clip || !layer || !sourceAllowed(layer, clip.source)) throw new Error(`Invalid clip slot ${slot.id}`)
  }

  return project
}
