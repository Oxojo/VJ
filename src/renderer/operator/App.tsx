import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RuntimeCommand } from '../../shared/commands/runtime'
import { createDefaultProject } from '../../shared/domain/defaultProject'
import type { LayerId, MacroValues, Project, Quantize, RuntimeSnapshot } from '../../shared/domain/types'
import { addAssets, captureScene, projectWithRuntime, slotLabel } from './project'

type CommandDraft = RuntimeCommand extends infer Command
  ? Command extends { requestId: string; sequence: number }
    ? Omit<Command, 'requestId' | 'sequence'>
    : never
  : never

const LAYER_COLORS: Record<LayerId, string> = { L1: '#f43f79', L2: '#36a3ff', L3: '#a3ff4f' }
const MACRO_LABELS: Array<{ key: keyof MacroValues; label: string }> = [
  { key: 'color', label: 'Color' },
  { key: 'motion', label: 'Motion' },
  { key: 'distort', label: 'Distort' },
  { key: 'reactive', label: 'Reactive' },
  { key: 'echo', label: 'Echo' }
]

function formatBeat(beat: number): string {
  const bar = Math.floor(beat / 4) + 1
  const within = Math.floor(((beat % 4) + 4) % 4) + 1
  return `${bar}.${within}`
}

export function App(): React.JSX.Element {
  const api = window.vjOperator
  const [project, setProject] = useState<Project>(() => createDefaultProject(crypto.randomUUID()))
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null)
  const [preview, setPreview] = useState<string>('')
  const [notice, setNotice] = useState('Output starts in blackout. Launch a slot, then take it live.')
  const [performanceMode, setPerformanceMode] = useState(false)
  const [audioDevice, setAudioDevice] = useState<string>('')
  const sequence = useRef(0)
  const initialized = useRef(false)

  const send = useCallback(
    (draft: CommandDraft): string => {
      if (!api) return ''
      const requestId = crypto.randomUUID()
      api.sendCommand({ ...draft, requestId, sequence: ++sequence.current } as RuntimeCommand)
      return requestId
    },
    [api]
  )

  useEffect(() => {
    if (!api) return
    const unsubscribe = [
      api.onSnapshot(setSnapshot),
      api.onPreview(setPreview),
      api.onWarning(setNotice),
      api.onCommandResult((result) => {
        if (result.status === 'rejected') setNotice(result.message ?? 'Command rejected')
      })
    ]
    if (!initialized.current) {
      initialized.current = true
      send({ type: 'loadProject', project })
    }
    return () => unsubscribe.forEach((cleanup) => cleanup())
  }, [api, project, send])

  const replaceProject = useCallback(
    (next: Project): void => {
      setProject(next)
      send({ type: 'loadProject', project: next })
      setNotice(`Loaded ${next.name}. Output returned to blackout.`)
    },
    [send]
  )

  const importAssets = async (): Promise<void> => {
    if (!api) return
    try {
      const assets = await api.importAssets()
      if (!assets.length) return
      const next = addAssets(project, assets)
      replaceProject(next)
      setNotice(`Imported ${assets.length} asset${assets.length === 1 ? '' : 's'}.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Import failed')
    }
  }

  const openProject = async (): Promise<void> => {
    if (!api) return
    try {
      const result = await api.openProject()
      if (!result.canceled && result.project) replaceProject(result.project)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Open failed')
    }
  }

  const saveProject = async (saveAs = false): Promise<void> => {
    if (!api) return
    try {
      const savedProject = projectWithRuntime(project, snapshot)
      const result = await api.saveProject(savedProject, saveAs)
      if (!result.canceled) {
        setProject(savedProject)
        setNotice(`Saved ${result.path ?? savedProject.name}`)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Save failed')
    }
  }

  const updateParameter = (path: string, value: number): void => {
    send({ type: 'setParameter', path, value })
    setProject((current) => {
      const next = structuredClone(current)
      if (path.startsWith('macros.')) {
        const key = path.slice(7) as keyof MacroValues
        next.defaults.macros[key] = value
      } else {
        const match = /^layers\.(L[1-3])\.opacity$/.exec(path)
        const layer = match ? next.layers.find((candidate) => candidate.id === match[1]) : undefined
        if (layer) layer.opacity = value
      }
      return next
    })
  }

  const grid = useMemo(() => {
    return Array.from({ length: 64 }, (_, index) => {
      const x = index % 8
      const y = Math.floor(index / 8)
      return { x, y, slot: project.slots.find((candidate) => candidate.x === x && candidate.y === y) }
    })
  }, [project.slots])

  const activeIds = new Set(snapshot?.layers.map((layer) => layer.activeClipId).filter(Boolean) ?? [])
  const pendingIds = new Set(snapshot?.layers.map((layer) => layer.pendingClipId).filter(Boolean) ?? [])
  const midiInputs = snapshot?.midi.inputs ?? []
  const midiOutputs = snapshot?.midi.outputs ?? []

  if (!api) {
    return <main className="fatal">Operator bridge unavailable. Start this page through Electron.</main>
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">VJ</div>
          <div>
            <input
              className="project-name"
              value={project.name}
              disabled={performanceMode}
              aria-label="Project name"
              onChange={(event) => setProject({ ...project, name: event.target.value })}
            />
            <div className="subline">SYSTEM / PERFORMANCE RUNTIME</div>
          </div>
        </div>

        <section className="transport" aria-label="Tempo controls">
          <label className="bpm-control">
            <span>BPM</span>
            <input
              type="number"
              min={60}
              max={300}
              step={0.1}
              value={(snapshot?.bpm ?? project.defaults.bpm).toFixed(1)}
              onChange={(event) => send({ type: 'setTempo', bpm: Number(event.target.value) })}
            />
          </label>
          <button onClick={() => send({ type: 'tapTempo', atMs: performance.now() })}>TAP</button>
          <button onClick={() => send({ type: 'halfTempo' })}>½</button>
          <button onClick={() => send({ type: 'doubleTempo' })}>×2</button>
          <button className="downbeat" onClick={() => send({ type: 'setDownbeat' })}>DOWNBEAT</button>
          <div className="beat-readout">
            <strong>{formatBeat(snapshot?.beat ?? 0)}</strong>
            <div className="phase-track"><span style={{ width: `${(snapshot?.barPhase ?? 0) * 100}%` }} /></div>
          </div>
          <select
            aria-label="Quantize"
            value={snapshot?.quantize ?? project.defaults.quantize}
            onChange={(event) => send({ type: 'setQuantize', quantize: event.target.value as Quantize })}
          >
            <option value="off">FREE</option>
            <option value="beat">1 BEAT</option>
            <option value="bar">1 BAR</option>
            <option value="four-bars">4 BARS</option>
          </select>
        </section>

        <div className="safety-controls">
          <button className={snapshot?.freeze ? 'freeze active' : 'freeze'} onClick={() => send({ type: 'setFreeze', enabled: !snapshot?.freeze })}>
            FREEZE
          </button>
          <button className={snapshot?.blackout ? 'blackout active' : 'blackout'} onClick={() => send({ type: 'setBlackout', enabled: !snapshot?.blackout })}>
            {snapshot?.blackout ? 'BLACKOUT ON' : 'TAKE BLACK'}
          </button>
        </div>
      </header>

      <div className="workspace">
        <section className="grid-panel panel">
          <div className="panel-heading">
            <div><span className="eyebrow">APC MINI MK2</span><h2>Performance Grid</h2></div>
            <div className="legend"><span className="l1">L1</span><span className="l2">L2</span><span className="l3">L3</span><span className="scene">SCENE</span></div>
          </div>
          <div className="grid-labels" aria-hidden="true">
            <span>L1 · MEDIA</span><span>L2 · MEDIA</span><span>L3 · VISUAL</span><span>SCENES</span>
          </div>
          <div className="performance-grid">
            {grid.map(({ x, y, slot }) => {
              const active = slot && activeIds.has(slot.targetId)
              const pending = slot && pendingIds.has(slot.targetId)
              const className = [
                'pad',
                x < 2 ? 'pad-l1' : x < 4 ? 'pad-l2' : x < 6 ? 'pad-l3' : 'pad-scene',
                active ? 'is-active' : '',
                pending ? 'is-pending' : '',
                !slot ? 'is-empty' : ''
              ].join(' ')
              return (
                <button
                  key={`${x}:${y}`}
                  className={className}
                  disabled={!slot}
                  title={slotLabel(project, slot)}
                  onClick={() => send({ type: 'launchSlot', x, y })}
                >
                  <span className="pad-index">{(7 - y) * 8 + x}</span>
                  <span className="pad-label">{slotLabel(project, slot)}</span>
                </button>
              )
            })}
          </div>
          <div className="grid-actions">
            <button disabled={performanceMode} onClick={() => void importAssets()}>＋ IMPORT MEDIA</button>
            <button
              disabled={!snapshot || performanceMode}
              onClick={() => {
                if (!snapshot) return
                try {
                  const next = captureScene(project, snapshot)
                  setProject(next)
                  send({ type: 'loadProject', project: next })
                  setNotice('Scene captured. Output returned to blackout after project sync.')
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : 'Unable to capture scene')
                }
              }}
            >
              ＋ CAPTURE SCENE
            </button>
          </div>
        </section>

        <aside className="right-stack">
          <section className="preview-panel panel">
            <div className="panel-heading compact">
              <div><span className="eyebrow">PROGRAM</span><h2>PGM Output</h2></div>
              <div className="runtime-stats"><span>{snapshot?.fps.toFixed(1) ?? '—'} FPS</span><span>{snapshot?.droppedFrames ?? 0} DROP</span></div>
            </div>
            <div className={snapshot?.blackout ? 'preview blackout-preview' : 'preview'}>
              {preview ? <img src={preview} alt="Program output preview" /> : <div className="preview-placeholder">WAITING FOR RUNTIME</div>}
              {snapshot?.blackout && <div className="blackout-label">BLACKOUT</div>}
            </div>
            <div className="preview-actions">
              <button onClick={() => void api.toggleOutputFullscreen()}>FULLSCREEN OUTPUT</button>
              <button onClick={() => void api.moveOutputPrimary()}>RECOVER WINDOW</button>
            </div>
          </section>

          <section className="layers-panel panel">
            <div className="panel-heading compact"><div><span className="eyebrow">MIXER</span><h2>Layers</h2></div></div>
            <div className="layer-strips">
              {(['L1', 'L2', 'L3'] as LayerId[]).map((layerId) => {
                const runtime = snapshot?.layers.find((layer) => layer.id === layerId)
                const value = runtime?.opacity ?? project.layers.find((layer) => layer.id === layerId)?.opacity ?? 0
                return (
                  <div className="layer-strip" key={layerId} style={{ '--layer-color': LAYER_COLORS[layerId] } as React.CSSProperties}>
                    <div className="layer-title"><strong>{layerId}</strong><span>{runtime?.prepareState ?? 'empty'}</span></div>
                    <input
                      aria-label={`${layerId} opacity`}
                      className="vertical-range"
                      type="range"
                      min={0}
                      max={1}
                      step={0.001}
                      value={value}
                      onChange={(event) => updateParameter(`layers.${layerId}.opacity`, Number(event.target.value))}
                    />
                    <output>{Math.round(value * 100)}</output>
                    <button
                      className={runtime?.muted ? 'mute active' : 'mute'}
                      onClick={() => send({ type: 'setParameter', path: `layers.${layerId}.muted`, value: runtime?.muted ? 0 : 1 })}
                    >MUTE</button>
                  </div>
                )
              })}
              <div className="layer-strip master" style={{ '--layer-color': '#ffffff' } as React.CSSProperties}>
                <div className="layer-title"><strong>MASTER</strong><span>level</span></div>
                <input
                  aria-label="Master brightness"
                  className="vertical-range"
                  type="range"
                  min={0}
                  max={1}
                  step={0.001}
                  value={snapshot?.masterBrightness ?? 1}
                  onChange={(event) => updateParameter('masterBrightness', Number(event.target.value))}
                />
                <output>{Math.round((snapshot?.masterBrightness ?? 1) * 100)}</output>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <section className="control-deck panel">
        <div className="macros">
          {MACRO_LABELS.map(({ key, label }) => {
            const value = snapshot?.macros[key] ?? project.defaults.macros[key]
            return (
              <label className="macro" key={key}>
                <span>{label}</span>
                <input type="range" min={0} max={1} step={0.001} value={value} onChange={(event) => updateParameter(`macros.${key}`, Number(event.target.value))} />
                <output>{Math.round(value * 100)}</output>
              </label>
            )
          })}
        </div>

        <div className="io-status">
          <div className="io-block">
            <span className={`status-dot ${snapshot?.midi.connected ? 'online' : ''}`} />
            <label>MIDI IN
              <select
                value={snapshot?.midi.inputId ?? ''}
                onChange={(event) => send({ type: 'setMidiPorts', inputId: event.target.value || null, outputId: snapshot?.midi.outputId ?? null })}
              >
                <option value="">Not connected</option>
                {midiInputs.map((port) => <option key={port.id} value={port.id}>{port.name}</option>)}
              </select>
            </label>
            <label>MIDI OUT
              <select
                value={snapshot?.midi.outputId ?? ''}
                onChange={(event) => send({ type: 'setMidiPorts', inputId: snapshot?.midi.inputId ?? null, outputId: event.target.value || null })}
              >
                <option value="">Not connected</option>
                {midiOutputs.map((port) => <option key={port.id} value={port.id}>{port.name}</option>)}
              </select>
            </label>
            <small>{snapshot?.midi.lastMessage ?? 'No MIDI messages'}</small>
          </div>
          <div className="io-block audio-block">
            <span className={`status-dot ${snapshot?.audio.connected ? 'online' : ''}`} />
            <label>AUDIO INPUT
              <select
                value={audioDevice}
                onChange={(event) => {
                  setAudioDevice(event.target.value)
                  send({ type: 'setAudioDevice', deviceId: event.target.value || null })
                }}
              >
                <option value="">Analysis off</option>
                {(snapshot?.audioDevices ?? []).map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
              </select>
            </label>
            <div className="meters">
              {(['rms', 'low', 'mid', 'high'] as const).map((band) => (
                <div key={band}><span>{band}</span><i><b style={{ width: `${(snapshot?.audio[band] ?? 0) * 100}%` }} /></i></div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="footerbar">
        <div className="file-actions">
          <button disabled={performanceMode} onClick={() => void openProject()}>OPEN</button>
          <button onClick={() => void saveProject(false)}>SAVE</button>
          <button onClick={() => void saveProject(true)}>SAVE AS</button>
          <button className={performanceMode ? 'mode active' : 'mode'} onClick={() => setPerformanceMode((current) => !current)}>
            {performanceMode ? 'PERFORMANCE MODE' : 'EDIT MODE'}
          </button>
        </div>
        <div className="notice" title={notice}>{snapshot?.warning ?? notice}</div>
        <div className="connection-summary">
          <span className={snapshot?.midi.connected ? 'ok' : ''}>APC</span>
          <span className={snapshot?.audio.connected ? 'ok' : ''}>AUDIO</span>
          <span className={snapshot ? 'ok' : ''}>RUNTIME</span>
        </div>
      </footer>
    </main>
  )
}
