import type { RegisterMain } from '@lumin/plugin-api'
import { registerMain as exampleRegisterMain } from '@lumin/tool-example/node'

export const toolMains: Readonly<Record<string, RegisterMain>> = {
  example: exampleRegisterMain
}
