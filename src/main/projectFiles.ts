import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { AssetRecord, OpenProjectResult, Project, SaveProjectResult } from '../shared/domain/types'
import { parseProject } from '../shared/schema/project'
import { MediaRegistry } from './mediaProtocol'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
}

function serializableProject(project: Project, projectPath: string): Project {
  const directory = dirname(projectPath)
  return {
    ...structuredClone(project),
    assets: project.assets.map((asset) => {
      const absolute = asset.path.absolutePathHint
      if (!absolute) return asset
      const relativePath = relative(directory, absolute)
      return {
        ...asset,
        path: {
          relativePath: relativePath || basename(absolute),
          absolutePathHint: absolute
        }
      }
    })
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export class ProjectFiles {
  private currentPath: string | null = null

  constructor(private readonly registry: MediaRegistry) {}

  async importAssets(window: BrowserWindow): Promise<AssetRecord[]> {
    const result = await dialog.showOpenDialog(window, {
      title: 'Import VJ media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported media', extensions: ['mp4', 'm4v', 'png', 'jpg', 'jpeg'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []

    const assets: AssetRecord[] = []
    for (const filePath of result.filePaths) {
      const extension = extname(filePath).toLowerCase()
      const mime = MIME_BY_EXTENSION[extension]
      if (!mime) continue
      const fileStat = await stat(filePath)
      const asset: AssetRecord = {
        id: randomUUID(),
        name: basename(filePath),
        kind: mime.startsWith('video/') ? 'video' : 'image',
        mime,
        size: fileStat.size,
        modifiedMs: fileStat.mtimeMs,
        path: { absolutePathHint: resolve(filePath) }
      }
      this.registry.registerAsset(asset, this.currentPath ? dirname(this.currentPath) : undefined)
      assets.push(asset)
    }
    return assets
  }

  async open(window: BrowserWindow): Promise<OpenProjectResult> {
    const result = await dialog.showOpenDialog(window, {
      title: 'Open VJ project',
      properties: ['openFile'],
      filters: [{ name: 'VJ project', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const projectPath = result.filePaths[0]
    const raw = await readFile(projectPath, 'utf8')
    const project = parseProject(JSON.parse(raw))
    this.currentPath = projectPath
    this.registry.registerProject(project, dirname(projectPath))
    return { canceled: false, path: projectPath, project }
  }

  async save(window: BrowserWindow, value: unknown, saveAs = false): Promise<SaveProjectResult> {
    const project = parseProject(value)
    let targetPath = saveAs ? null : this.currentPath
    if (!targetPath) {
      const result = await dialog.showSaveDialog(window, {
        title: 'Save VJ project',
        defaultPath: `${project.name.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'project'}.vj.json`,
        filters: [{ name: 'VJ project', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      targetPath = result.filePath
    }

    await mkdir(dirname(targetPath), { recursive: true })
    const persisted = serializableProject(project, targetPath)
    const temporaryPath = `${targetPath}.tmp`
    const backupPath = `${targetPath}.bak`
    const handle = await open(temporaryPath, 'w')
    try {
      await handle.writeFile(`${JSON.stringify(persisted, null, 2)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }

    const hadOriginal = await pathExists(targetPath)
    if (hadOriginal) {
      await copyFile(targetPath, backupPath)
      await rm(targetPath)
    }
    try {
      await rename(temporaryPath, targetPath)
    } catch (error) {
      if (hadOriginal && (await pathExists(backupPath))) await copyFile(backupPath, targetPath)
      throw error
    } finally {
      await rm(temporaryPath, { force: true })
    }

    this.currentPath = targetPath
    this.registry.registerProject(project, dirname(targetPath))
    return { canceled: false, path: targetPath }
  }
}
