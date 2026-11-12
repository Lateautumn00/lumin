import type { SleepPayload } from '../schema'

export function ping(): Promise<{ pong: boolean; at: number }> {
  return window.lumin.invoke('example:ping')
}

export function submitSleep(payload: SleepPayload): Promise<{ taskId: string }> {
  return window.lumin.invoke('example:sleep', payload)
}
