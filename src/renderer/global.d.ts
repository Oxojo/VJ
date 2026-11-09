import type { RuntimeCommand } from '../shared/commands/runtime'
import type {
  AssetRecord,
  CommandResult,
  OpenProjectResult,
  Project,
  RuntimeSnapshot,
  SaveProjectResult
} from '../shared/domain/types'

interface VjOperatorApi {
  importAssets(): Promise<AssetRecord[]>
  openProject(): Promise<OpenProjectResult>
  saveProject(project: Project, saveAs?: boolean): Promise<SaveProjectResult>
  sendCommand(command: RuntimeCommand): void
  toggleOutputFullscreen(): Promise<boolean>
  moveOutputPrimary(): Promise<void>
  onSnapshot(callback: (snapshot: RuntimeSnapshot) => void): () => void
  onCommandResult(callback: (result: CommandResult) => void): () => void
  onPreview(callback: (preview: string) => void): () => void
  onWarning(callback: (warning: string) => void): () => void
}

interface VjPerformanceApi {
  onCommand(callback: (command: RuntimeCommand) => void): () => void
  publishSnapshot(snapshot: RuntimeSnapshot): void
  publishResult(result: CommandResult): void
  publishPreview(preview: string): void
}

declare global {
  interface Window {
    vjOperator?: VjOperatorApi
    vjPerformance?: VjPerformanceApi
  }
}

export {}
