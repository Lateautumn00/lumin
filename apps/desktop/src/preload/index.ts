import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  LUMIN_INVOKE_CHANNEL,
  TASK_EVENT_CHANNEL,
  UPDATE_EVENT_CHANNEL,
  invokeResponseSchema,
  makeError,
  taskEventSchema,
  updateEventSchema,
  type InvokeResponse,
  type TaskEvent,
  type UpdateEvent
} from '@lumin/shared'
import type { LuminBridge } from '@lumin/plugin-api'

async function invoke<R>(channel: string, payload?: unknown): Promise<R> {
  const raw: unknown = await ipcRenderer.invoke(LUMIN_INVOKE_CHANNEL, { channel, payload })
  const parsed = invokeResponseSchema.safeParse(raw)
  if (!parsed.success) throw makeError('INTERNAL', '响应格式无效')
  const response: InvokeResponse = parsed.data
  if (response.ok) return response.data as R
  throw response.error
}

const bridge: LuminBridge = {
  invoke,
  onTaskEvent(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: TaskEvent): void => {
      const parsed = taskEventSchema.safeParse(payload)
      if (parsed.success) listener(parsed.data)
    }
    ipcRenderer.on(TASK_EVENT_CHANNEL, wrapped)
    return () => {
      ipcRenderer.off(TASK_EVENT_CHANNEL, wrapped)
    }
  },
  onUpdateEvent(listener) {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: UpdateEvent): void => {
      const parsed = updateEventSchema.safeParse(payload)
      if (parsed.success) listener(parsed.data)
    }
    ipcRenderer.on(UPDATE_EVENT_CHANNEL, wrapped)
    return () => {
      ipcRenderer.off(UPDATE_EVENT_CHANNEL, wrapped)
    }
  },
  getAppInfo: () => invoke('lumin:app:info'),
  openLogDir: () => invoke('lumin:log:open-dir'),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  revealPath: (path) => invoke('lumin:shell:reveal', { path }),
  openPath: (path) => invoke('lumin:shell:open', { path }),
  trashPaths: (paths) => invoke('lumin:shell:trash', { paths: [...paths] }),
  pickDirectory: (title) =>
    invoke<string | null>('lumin:shell:pick-directory', title === undefined ? {} : { title }),
  pickSaveFile: (options) =>
    invoke<string | null>('lumin:shell:pick-save-file', options === undefined ? {} : options),
  settings: {
    get: <T>(key: string, defaultValue: T): Promise<T> =>
      invoke<T>('lumin:settings:get', { key, defaultValue }),
    set: (key, value) => invoke('lumin:settings:set', { key, value })
  }
}

contextBridge.exposeInMainWorld('lumin', bridge)
