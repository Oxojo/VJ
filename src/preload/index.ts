import { contextBridge, ipcRenderer } from 'electron'
import type {
  AssetRecord,
  CommandResult,
  OpenProjectResult,
  Project,
  RuntimeSnapshot,
  SaveProjectResult
} from '../shared/domain/types'
import type { RuntimeCommand } from '../shared/commands/runtime'

const role = process.argv.find((argument) => argument.startsWith('--vj-role='))?.split('=')[1]

const subscribe = <T>(channel: string, callback: (value: T) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

if (role === 'operator') {
  contextBridge.exposeInMainWorld('vjOperator', {
    importAssets: (): Promise<AssetRecord[]> => ipcRenderer.invoke('project:import-assets'),
    openProject: (): Promise<OpenProjectResult> => ipcRenderer.invoke('project:open'),
    saveProject: (project: Project, saveAs = false): Promise<SaveProjectResult> =>
      ipcRenderer.invoke('project:save', project, saveAs),
    sendCommand: (command: RuntimeCommand): void => ipcRenderer.send('runtime:command', command),
    toggleOutputFullscreen: (): Promise<boolean> => ipcRenderer.invoke('output:toggle-fullscreen'),
    moveOutputPrimary: (): Promise<void> => ipcRenderer.invoke('output:move-primary'),
    onSnapshot: (callback: (snapshot: RuntimeSnapshot) => void): (() => void) =>
      subscribe('runtime:snapshot', callback),
    onCommandResult: (callback: (result: CommandResult) => void): (() => void) =>
      subscribe('runtime:result', callback),
    onPreview: (callback: (preview: string) => void): (() => void) => subscribe('runtime:preview', callback),
    onWarning: (callback: (warning: string) => void): (() => void) => subscribe('output:warning', callback)
  })
}

if (role === 'performance') {
  contextBridge.exposeInMainWorld('vjPerformance', {
    onCommand: (callback: (command: RuntimeCommand) => void): (() => void) =>
      subscribe('runtime:command', callback),
    publishSnapshot: (snapshot: RuntimeSnapshot): void => ipcRenderer.send('runtime:snapshot', snapshot),
    publishResult: (result: CommandResult): void => ipcRenderer.send('runtime:result', result),
    publishPreview: (preview: string): void => ipcRenderer.send('runtime:preview', preview)
  })
}
