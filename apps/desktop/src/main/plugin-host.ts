import type {
  IpcHandler,
  MainPluginContext,
  RegisterMain,
  TaskHandler,
  ToolLogger,
  ToolManifest,
  ToolPaths,
  ToolSettings
} from '@lumin/plugin-api'
import { toolManifestSchema } from '@lumin/plugin-api'
import { channelSchema } from '@lumin/shared'
import type { IpcBus } from './ipc-bus'

export interface ToolRegistration {
  manifest: ToolManifest
  registerMain?: RegisterMain
}

export interface LoadToolsDeps {
  bus: IpcBus
  createSettings: (toolId: string) => ToolSettings
  createLogger: (toolId: string) => ToolLogger
  logger: ToolLogger
  paths: ToolPaths
}

export interface LoadToolsResult {
  loaded: ToolManifest[]
  failed: Array<{ id: string; message: string }>
}

export async function loadTools(
  registrations: readonly ToolRegistration[],
  deps: LoadToolsDeps
): Promise<LoadToolsResult> {
  const loaded: ToolManifest[] = []
  const failed: Array<{ id: string; message: string }> = []

  for (const reg of registrations) {
    const parsed = toolManifestSchema.safeParse(reg.manifest)
    if (!parsed.success) {
      failed.push({
        id: 'unknown',
        message: `清单校验失败：${parsed.error.issues[0]?.message ?? '未知错误'}`
      })
      continue
    }
    const manifest = parsed.data
    if (!reg.registerMain) {
      loaded.push(manifest)
      continue
    }
    try {
      const register = (action: string): string => {
        const channel = `${manifest.id}:${action}`
        if (!channelSchema.safeParse(channel).success) throw new Error(`非法 action：${action}`)
        return channel
      }
      const ctx: MainPluginContext = {
        toolId: manifest.id,
        manifest,
        registerIpc: <P, R>(action: string, handler: IpcHandler<P, R>): void => {
          deps.bus.registerSync(
            register(action),
            manifest.id,
            action,
            handler as unknown as IpcHandler<unknown, unknown>
          )
        },
        registerTask: <P, R>(action: string, handler: TaskHandler<P, R>): void => {
          deps.bus.registerTask(
            register(action),
            manifest.id,
            action,
            handler as unknown as TaskHandler<unknown, unknown>
          )
        },
        settings: deps.createSettings(manifest.id),
        log: deps.createLogger(manifest.id),
        paths: deps.paths
      }
      await reg.registerMain(ctx)
      loaded.push(manifest)
    } catch (err) {
      deps.logger.error(`工具装载失败：${manifest.id}`, err)
      failed.push({ id: manifest.id, message: err instanceof Error ? err.message : String(err) })
    }
  }
  return { loaded, failed }
}
