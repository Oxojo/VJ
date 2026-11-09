import { z } from 'zod'
import { projectSchema } from '../schema/project'

const request = z.object({ requestId: z.string().min(1), sequence: z.number().int().nonnegative() })
const layerId = z.enum(['L1', 'L2', 'L3'])

export const runtimeCommandSchema = z.discriminatedUnion('type', [
  request.extend({ type: z.literal('loadProject'), project: projectSchema }),
  request.extend({ type: z.literal('launchSlot'), x: z.number().int().min(0).max(7), y: z.number().int().min(0).max(7) }),
  request.extend({ type: z.literal('launchScene'), sceneId: z.string().min(1) }),
  request.extend({ type: z.literal('cancelPending'), layerId: layerId.or(z.literal('all')) }),
  request.extend({ type: z.literal('stopLayer'), layerId }),
  request.extend({ type: z.literal('retriggerLayer'), layerId }),
  request.extend({ type: z.literal('setParameter'), path: z.string().min(1), value: z.number().finite() }),
  request.extend({ type: z.literal('setTempo'), bpm: z.number().finite().min(60).max(300) }),
  request.extend({ type: z.literal('tapTempo'), atMs: z.number().finite().nonnegative().optional() }),
  request.extend({ type: z.literal('halfTempo') }),
  request.extend({ type: z.literal('doubleTempo') }),
  request.extend({ type: z.literal('setDownbeat') }),
  request.extend({ type: z.literal('nudge'), beats: z.number().finite().min(-1).max(1) }),
  request.extend({ type: z.literal('setQuantize'), quantize: z.enum(['off', 'beat', 'bar', 'four-bars']) }),
  request.extend({ type: z.literal('setBlackout'), enabled: z.boolean() }),
  request.extend({ type: z.literal('setFreeze'), enabled: z.boolean() }),
  request.extend({ type: z.literal('setMidiPorts'), inputId: z.string().nullable(), outputId: z.string().nullable() }),
  request.extend({ type: z.literal('refreshMidi') }),
  request.extend({ type: z.literal('setAudioDevice'), deviceId: z.string().nullable() }),
  request.extend({ type: z.literal('refreshAudioDevices') })
])

export type RuntimeCommand = z.infer<typeof runtimeCommandSchema>

export function parseRuntimeCommand(value: unknown): RuntimeCommand {
  return runtimeCommandSchema.parse(value)
}
