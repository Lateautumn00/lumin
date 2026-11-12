import type { RegisterMain } from '@lumin/plugin-api'
import { makeError } from '@lumin/shared'
import { sleepPayloadSchema } from './schema'

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export const registerMain: RegisterMain = (ctx) => {
  ctx.registerIpc('ping', () => ({ pong: true, at: Date.now() }))

  ctx.registerTask('sleep', async ({ payload, signal, emit }) => {
    const parsed = sleepPayloadSchema.safeParse(payload)
    if (!parsed.success) throw makeError('INVALID_PAYLOAD', '时长参数无效（100–30000ms）')
    const { durationMs } = parsed.data
    const steps = Math.ceil(durationMs / 100)
    for (let step = 1; step <= steps; step += 1) {
      if (signal.aborted) throw new Error('aborted')
      const remaining = durationMs - (step - 1) * 100
      await sleep(Math.min(100, remaining), signal)
      emit({ kind: 'progress', current: step, total: steps, message: `${step}/${steps}` })
    }
    return { slept: durationMs }
  })
}
