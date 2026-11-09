import { describe, expect, it } from 'vitest'
import { createDefaultProject } from '../../src/shared/domain/defaultProject'
import { parseProject } from '../../src/shared/schema/project'

describe('project schema', () => {
  it('accepts the built-in starter project', () => {
    expect(parseProject(createDefaultProject()).schemaVersion).toBe(1)
  })

  it('rejects unknown future schema versions', () => {
    const project: any = createDefaultProject()
    project.schemaVersion = 2
    expect(() => parseProject(project)).toThrow()
  })

  it('rejects duplicate grid positions', () => {
    const project = createDefaultProject()
    project.slots.push({ ...project.slots[0]!, id: 'duplicate-slot' })
    expect(() => parseProject(project)).toThrow(/Duplicate slot position/)
  })

  it('rejects video sources assigned to the generator layer', () => {
    const project = createDefaultProject()
    project.assets.push({
      id: 'video-asset',
      name: 'video.mp4',
      kind: 'video',
      mime: 'video/mp4',
      size: 100,
      modifiedMs: 1,
      path: { absolutePathHint: '/tmp/video.mp4' }
    })
    project.clips.push({
      id: 'video-clip',
      name: 'Video',
      source: { kind: 'video', assetId: 'video-asset', inSec: 0, outSec: null, loop: true, rate: 1, sync: { mode: 'free' } }
    })
    project.slots.push({ id: 'invalid-l3', x: 4, y: 0, kind: 'clip', targetId: 'video-clip' })
    expect(() => parseProject(project)).toThrow(/Invalid clip slot/)
  })
})
