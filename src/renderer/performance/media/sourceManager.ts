import type { LayerId, SourceSpec } from '../../../shared/domain/types'

export interface PreparedSource {
  source: SourceSpec
  element: HTMLVideoElement | HTMLImageElement | null
  width: number
  height: number
  dispose(): void
}

function assetUrl(assetId: string): string {
  return `vjmedia://asset/${encodeURIComponent(assetId)}`
}

function waitFor(target: EventTarget, eventName: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${eventName}`))
    }, timeoutMs)
    const onEvent = (): void => {
      cleanup()
      resolve()
    }
    const onError = (): void => {
      cleanup()
      reject(new Error('Media failed to load'))
    }
    const cleanup = (): void => {
      window.clearTimeout(timeout)
      target.removeEventListener(eventName, onEvent)
      target.removeEventListener('error', onError)
    }
    target.addEventListener(eventName, onEvent, { once: true })
    target.addEventListener('error', onError, { once: true })
  })
}

async function prepareVideo(source: Extract<SourceSpec, { kind: 'video' }>, bpm: number): Promise<PreparedSource> {
  const video = document.createElement('video')
  video.muted = true
  video.loop = source.loop
  video.playsInline = true
  video.preload = 'auto'
  video.disablePictureInPicture = true
  video.src = assetUrl(source.assetId)
  video.load()
  await waitFor(video, 'loadedmetadata', 10_000)

  const inPoint = Math.min(source.inSec, Math.max(0, video.duration - 0.01))
  if (Math.abs(video.currentTime - inPoint) > 0.001) {
    video.currentTime = inPoint
    await waitFor(video, 'seeked', 10_000)
  }
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitFor(video, 'loadeddata', 10_000)

  video.playbackRate =
    source.sync.mode === 'tempo' ? (bpm / source.sync.sourceBpm) * source.sync.multiplier : source.rate
  return {
    source,
    element: video,
    width: video.videoWidth || 16,
    height: video.videoHeight || 9,
    dispose: () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }
}

async function prepareImage(source: Extract<SourceSpec, { kind: 'image' }>): Promise<PreparedSource> {
  const image = new Image()
  image.decoding = 'async'
  image.src = assetUrl(source.assetId)
  await waitFor(image, 'load', 10_000)
  await image.decode().catch(() => undefined)
  return {
    source,
    element: image,
    width: image.naturalWidth || 16,
    height: image.naturalHeight || 9,
    dispose: () => {
      image.src = ''
    }
  }
}

export class SourceManager {
  private active = new Map<LayerId, PreparedSource>()

  async prepare(source: SourceSpec, bpm: number): Promise<PreparedSource> {
    if (source.kind === 'video') return prepareVideo(source, bpm)
    if (source.kind === 'image') return prepareImage(source)
    return {
      source,
      element: null,
      width: 16,
      height: 9,
      dispose: () => undefined
    }
  }

  async activate(layerId: LayerId, prepared: PreparedSource): Promise<void> {
    const previous = this.active.get(layerId)
    this.active.set(layerId, prepared)
    if (prepared.element instanceof HTMLVideoElement) {
      await prepared.element.play().catch((error: unknown) => {
        throw new Error(error instanceof Error ? error.message : 'Video playback failed')
      })
    }
    if (previous !== prepared) previous?.dispose()
  }

  stop(layerId: LayerId): void {
    this.active.get(layerId)?.dispose()
    this.active.delete(layerId)
  }

  retrigger(layerId: LayerId): void {
    const active = this.active.get(layerId)
    if (!active || !(active.element instanceof HTMLVideoElement) || active.source.kind !== 'video') return
    active.element.currentTime = active.source.inSec
    void active.element.play()
  }

  updateTempo(bpm: number): void {
    for (const active of this.active.values()) {
      if (!(active.element instanceof HTMLVideoElement) || active.source.kind !== 'video') continue
      const rate =
        active.source.sync.mode === 'tempo'
          ? (bpm / active.source.sync.sourceBpm) * active.source.sync.multiplier
          : active.source.rate
      if (rate >= 0.5 && rate <= 2) active.element.playbackRate = rate
    }
  }

  get(layerId: LayerId): PreparedSource | null {
    return this.active.get(layerId) ?? null
  }

  clear(): void {
    for (const source of this.active.values()) source.dispose()
    this.active.clear()
  }
}
