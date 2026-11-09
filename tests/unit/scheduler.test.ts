import { describe, expect, it } from 'vitest'
import { LaunchScheduler } from '../../src/shared/domain/scheduler'

describe('LaunchScheduler', () => {
  it('lets the newest request win and ignores stale preparation completion', () => {
    const scheduler = new LaunchScheduler<string>()
    const stale = scheduler.arm('L1', 'first')
    const current = scheduler.arm('L1', 'second')
    expect(scheduler.markReady('L1', stale, 1.2, 'beat')).toBeNull()
    expect(scheduler.markReady('L1', current, 1.2, 'beat')?.targetBeat).toBe(2)
    expect(scheduler.takeDue(1.999)).toHaveLength(0)
    expect(scheduler.takeDue(2)).toEqual([
      { layerId: 'L1', launch: expect.objectContaining({ generation: current, payload: 'second' }) }
    ])
  })

  it('fires an unquantized ready source on the next frame check', () => {
    const scheduler = new LaunchScheduler<string>()
    const generation = scheduler.arm('L2', 'ready')
    scheduler.markReady('L2', generation, 7.123, 'off')
    expect(scheduler.takeDue(7.123)[0]?.launch.payload).toBe('ready')
  })

  it('cancels one layer without dropping another layer', () => {
    const scheduler = new LaunchScheduler<string>()
    scheduler.arm('L1', 'one')
    scheduler.arm('L2', 'two')
    scheduler.cancel('L1')
    expect(scheduler.get('L1')).toBeUndefined()
    expect(scheduler.get('L2')?.payload).toBe('two')
  })
})
