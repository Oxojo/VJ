import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, screen, session } from 'electron'
import { parseRuntimeCommand } from '../shared/commands/runtime'
import { parseProject } from '../shared/schema/project'
import type { RuntimeSnapshot } from '../shared/domain/types'
import { installMediaProtocol, MediaRegistry, registerMediaScheme } from './mediaProtocol'
import { ProjectFiles } from './projectFiles'

registerMediaScheme()

let operatorWindow: BrowserWindow | null = null
let performanceWindow: BrowserWindow | null = null
let isQuitting = false
const registry = new MediaRegistry()
const projectFiles = new ProjectFiles(registry)

function preloadPath(): string {
  return join(__dirname, '../preload/index.cjs')
}

function loadRenderer(window: BrowserWindow, role: 'operator' | 'performance'): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    url.searchParams.set('view', role)
    void window.loadURL(url.toString())
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: role } })
  }
}

function createPerformanceWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 960,
    height: 540,
    minWidth: 640,
    minHeight: 360,
    title: 'VJ System — Output',
    frame: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      additionalArguments: ['--vj-role=performance'],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  window.setTitle('VJ System — Output')
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    performanceWindow = null
    if (!isQuitting) performanceWindow = createPerformanceWindow()
  })
  loadRenderer(window, 'performance')
  return window
}

function createOperatorWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'VJ System',
    backgroundColor: '#0a0c10',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: preloadPath(),
      additionalArguments: ['--vj-role=operator'],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    operatorWindow = null
  })
  loadRenderer(window, 'operator')
  return window
}

function isOperatorSender(senderId: number): boolean {
  return operatorWindow?.webContents.id === senderId
}

function isPerformanceSender(senderId: number): boolean {
  return performanceWindow?.webContents.id === senderId
}

function installPermissions(): void {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    const internal = requestingOrigin.startsWith('file:') || requestingOrigin.startsWith('http://localhost:')
    return internal && (permission === 'media' || permission === 'midi')
  })
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = details.requestingUrl
    const internal =
      webContents.id === performanceWindow?.webContents.id &&
      (origin.startsWith('file:') || origin.startsWith('http://localhost:'))
    callback(Boolean(internal && (permission === 'media' || permission === 'midi')))
  })
}

function installIpc(): void {
  ipcMain.handle('project:import-assets', async (event) => {
    if (!isOperatorSender(event.sender.id) || !operatorWindow) throw new Error('Unauthorized sender')
    return projectFiles.importAssets(operatorWindow)
  })
  ipcMain.handle('project:open', async (event) => {
    if (!isOperatorSender(event.sender.id) || !operatorWindow) throw new Error('Unauthorized sender')
    return projectFiles.open(operatorWindow)
  })
  ipcMain.handle('project:save', async (event, project: unknown, saveAs: boolean) => {
    if (!isOperatorSender(event.sender.id) || !operatorWindow) throw new Error('Unauthorized sender')
    parseProject(project)
    return projectFiles.save(operatorWindow, project, saveAs)
  })
  ipcMain.on('runtime:command', (event, value: unknown) => {
    if (!isOperatorSender(event.sender.id) || !performanceWindow) return
    try {
      const command = parseRuntimeCommand(value)
      performanceWindow.webContents.send('runtime:command', command)
    } catch (error) {
      const requestId =
        typeof value === 'object' && value && 'requestId' in value ? String(value.requestId) : 'invalid-command'
      operatorWindow?.webContents.send('runtime:result', {
        requestId,
        status: 'rejected',
        message: error instanceof Error ? error.message : 'Invalid command'
      })
    }
  })
  ipcMain.on('runtime:snapshot', (event, snapshot: RuntimeSnapshot) => {
    if (isPerformanceSender(event.sender.id)) operatorWindow?.webContents.send('runtime:snapshot', snapshot)
  })
  ipcMain.on('runtime:result', (event, result: unknown) => {
    if (isPerformanceSender(event.sender.id)) operatorWindow?.webContents.send('runtime:result', result)
  })
  ipcMain.on('runtime:preview', (event, preview: string) => {
    if (isPerformanceSender(event.sender.id)) operatorWindow?.webContents.send('runtime:preview', preview)
  })
  ipcMain.handle('output:toggle-fullscreen', (event) => {
    if (!isOperatorSender(event.sender.id) || !performanceWindow) return false
    performanceWindow.setFullScreen(!performanceWindow.isFullScreen())
    return performanceWindow.isFullScreen()
  })
  ipcMain.handle('output:move-primary', (event) => {
    if (!isOperatorSender(event.sender.id) || !performanceWindow) return
    const bounds = screen.getPrimaryDisplay().workArea
    performanceWindow.setFullScreen(false)
    performanceWindow.setBounds({ x: bounds.x + 40, y: bounds.y + 40, width: 960, height: 540 })
    performanceWindow.show()
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.whenReady().then(() => {
  installMediaProtocol(registry)
  performanceWindow = createPerformanceWindow()
  operatorWindow = createOperatorWindow()
  installPermissions()
  installIpc()

  screen.on('display-removed', (_event, display) => {
    if (!performanceWindow) return
    const bounds = performanceWindow.getBounds()
    if (bounds.x >= display.bounds.x && bounds.x < display.bounds.x + display.bounds.width) {
      const primary = screen.getPrimaryDisplay().workArea
      performanceWindow.setFullScreen(false)
      performanceWindow.setBounds({ x: primary.x + 40, y: primary.y + 40, width: 960, height: 540 })
      operatorWindow?.webContents.send('output:warning', 'Output display disconnected; window moved to primary display.')
    }
  })

  app.on('activate', () => {
    if (!operatorWindow) operatorWindow = createOperatorWindow()
    if (!performanceWindow) performanceWindow = createPerformanceWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

