import { z } from 'zod'

export const sleepPayloadSchema = z.object({
  durationMs: z.number().int().min(100).max(30000)
})

export type SleepPayload = z.infer<typeof sleepPayloadSchema>
