import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, isAbsolute, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import type { AssetRecord, Project } from '../shared/domain/types'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
}

export class MediaRegistry {
  private paths = new Map<string, string>()

  registerAsset(asset: AssetRecord, projectDirectory?: string): void {
    const relative = asset.path.relativePath
    const absoluteHint = asset.path.absolutePathHint
    const relativeCandidate = relative && projectDirectory ? resolve(projectDirectory, relative) : undefined
    const resolved =
      relativeCandidate && existsSync(relativeCandidate)
        ? relativeCandidate
        : absoluteHint && existsSync(absoluteHint)
          ? absoluteHint
          : relativeCandidate ?? absoluteHint
    if (resolved && isAbsolute(resolved)) this.paths.set(asset.id, resolved)
  }

  registerProject(project: Project, projectDirectory?: string): void {
    this.paths.clear()
    for (const asset of project.assets) this.registerAsset(asset, projectDirectory)
  }

  get(assetId: string): string | undefined {
    return this.paths.get(assetId)
  }
}

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'vjmedia',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false
      }
    }
  ])
}

function parseRange(rangeHeader: string | null, size: number): { start: number; end: number } | null {
  if (!rangeHeader) return null
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) return null
  const start = Number(match[1])
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
    return null
  }
  return { start, end }
}

export function installMediaProtocol(registry: MediaRegistry): void {
  protocol.handle('vjmedia', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'asset') return new Response('Not found', { status: 404 })
      const assetId = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const filePath = registry.get(assetId)
      if (!filePath) return new Response('Unknown asset', { status: 404 })

      const fileStat = await stat(filePath)
      if (!fileStat.isFile()) return new Response('Not a file', { status: 404 })
      if (fileStat.size === 0) return new Response('Empty media file', { status: 416 })
      const mime = MIME_BY_EXTENSION[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      const rangeHeader = request.headers.get('range')
      const range = parseRange(rangeHeader, fileStat.size)

      if (rangeHeader && !range) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${fileStat.size}` } })
      }

      const start = range?.start ?? 0
      const end = range?.end ?? fileStat.size - 1
      const length = end - start + 1
      const headers = new Headers({
        'Accept-Ranges': 'bytes',
        'Content-Type': mime,
        'Content-Length': String(length),
        'Cache-Control': 'no-store'
      })
      if (range) headers.set('Content-Range', `bytes ${start}-${end}/${fileStat.size}`)
      if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers })

      const stream = createReadStream(filePath, { start, end })
      const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>
      return new Response(webStream, { status: range ? 206 : 200, headers })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Media request failed'
      return new Response(message, { status: 500 })
    }
  })
}
