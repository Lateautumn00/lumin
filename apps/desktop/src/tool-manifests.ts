import type { ToolManifest } from '@lumin/plugin-api'
import { manifest as calculatorManifest } from '@lumin/tool-calculator/manifest'
import { manifest as exampleManifest } from '@lumin/tool-example/manifest'

/** 壳内唯一工具清单（Q14）：新增工具 = 新包 + 此处 1 行 + tool-mains 1 行（如有主进程）+ renderer 薄壳 1 行 */
export const toolManifests: readonly ToolManifest[] = [calculatorManifest, exampleManifest]
