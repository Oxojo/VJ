import type { AssetRecord, ClipRecord, LayerId, Project, RuntimeSnapshot, SlotRecord } from '../../shared/domain/types'

function emptyPositions(project: Project, columns: number[]): Array<{ x: number; y: number }> {
  const occupied = new Set(project.slots.map((slot) => `${slot.x}:${slot.y}`))
  const positions: Array<{ x: number; y: number }> = []
  for (let y = 7; y >= 0; y -= 1) {
    for (const x of columns) {
      if (!occupied.has(`${x}:${y}`)) positions.push({ x, y })
    }
  }
  return positions
}

export function addAssets(project: Project, assets: AssetRecord[]): Project {
  const next = structuredClone(project)
  const visualPositions = emptyPositions(next, [0, 1, 2, 3])
  const imagePositions = emptyPositions(next, [4, 5])

  for (const asset of assets) {
    const clip: ClipRecord = {
      id: crypto.randomUUID(),
      name: asset.name,
      source:
        asset.kind === 'video'
          ? {
              kind: 'video',
              assetId: asset.id,
              inSec: 0,
              outSec: null,
              loop: true,
              rate: 1,
              sync: { mode: 'free' }
            }
          : { kind: 'image', assetId: asset.id }
    }
    const position = visualPositions.shift() ?? (asset.kind === 'image' ? imagePositions.shift() : undefined)
    next.assets.push(asset)
    next.clips.push(clip)
    if (position) {
      next.slots.push({
        id: crypto.randomUUID(),
        x: position.x,
        y: position.y,
        kind: 'clip',
        targetId: clip.id
      })
    }
  }
  return next
}

export function captureScene(project: Project, snapshot: RuntimeSnapshot): Project {
  const position = emptyPositions(project, [6, 7])[0]
  if (!position) throw new Error('All scene slots are occupied')
  const next = structuredClone(project)
  const sceneId = crypto.randomUUID()
  const layers = next.layers.map((layer) => {
    const runtime = snapshot.layers.find((candidate) => candidate.id === layer.id)
    return {
      ...layer,
      clipId: runtime?.activeClipId ?? null,
      opacity: runtime?.opacity ?? layer.opacity,
      blend: runtime?.blend ?? layer.blend,
      muted: runtime?.muted ?? layer.muted
    }
  })
  next.scenes.push({
    id: sceneId,
    name: `Scene ${next.scenes.length + 1}`,
    layers,
    macros: { ...snapshot.macros }
  })
  next.slots.push({ id: crypto.randomUUID(), x: position.x, y: position.y, kind: 'scene', targetId: sceneId })
  return next
}

export function projectWithRuntime(project: Project, snapshot: RuntimeSnapshot | null): Project {
  if (!snapshot) return project
  const next = structuredClone(project)
  next.defaults.bpm = snapshot.bpm
  next.defaults.quantize = snapshot.quantize
  next.defaults.macros = { ...snapshot.macros }
  next.layers = next.layers.map((layer) => {
    const runtime = snapshot.layers.find((candidate) => candidate.id === layer.id)
    return runtime
      ? {
          ...layer,
          clipId: runtime.activeClipId,
          opacity: runtime.opacity,
          blend: runtime.blend,
          muted: runtime.muted
        }
      : layer
  })
  return next
}

export function slotLabel(project: Project, slot: SlotRecord | undefined): string {
  if (!slot) return ''
  if (slot.kind === 'scene') return project.scenes.find((scene) => scene.id === slot.targetId)?.name ?? 'Missing scene'
  return project.clips.find((clip) => clip.id === slot.targetId)?.name ?? 'Missing clip'
}

export function layerForSlot(x: number): LayerId | null {
  if (x < 2) return 'L1'
  if (x < 4) return 'L2'
  if (x < 6) return 'L3'
  return null
}
