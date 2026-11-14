import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { MainPluginContext, TaskHandler } from '@lumin/plugin-api'
import { locateSoffice } from './locate'
import { manifest } from './manifest'
import { createNodeDeps, registerWith } from './node'

const fixtureFile = fileURLToPath(new URL('../fixtures/保真样例.docx', import.meta.url))
const deps = createNodeDeps()

// 无 soffice 环境（CI）→ 整组跳过（同 update-smoke 的 guard 模式）
const locate = await locateSoffice({
  customPath: '',
  portableDir: join(tmpdir(), 'lumin-d2p-no-portable'),
  queryRegistry: deps.queryRegistry,
  exists: deps.fileExists
})
const hasSoffice = locate.source !== 'none' && locate.path !== undefined

/** pdfjs 提取整份 PDF 文本（拼接所有页） */
async function extractPdfText(path: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await readFile(path))
  const loadingTask = pdfjs.getDocument({ data })
  try {
    const doc = await loadingTask.promise
    let text = ''
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
      const page = await doc.getPage(pageNo)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if ('str' in item) text += item.str
      }
    }
    return text
  } finally {
    await loadingTask.destroy()
  }
}

function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key)
  if (value === undefined) throw new Error(`缺少 handler：${String(key)}`)
  return value
}

describe.skipIf(!hasSoffice)('docx2pdf 保真 fixture 集成（本机有 soffice 才跑）', () => {
  const roots: string[] = []

  afterAll(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('真实转换保真样例.docx → PDF 文本含标题/表格/页眉关键串', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lumin-d2p-it-'))
    roots.push(root)
    const tempRoot = join(root, 'temp')
    const userDataRoot = join(root, 'userData')
    const inputDir = join(root, 'in')
    mkdirSync(tempRoot, { recursive: true })
    mkdirSync(userDataRoot, { recursive: true })
    mkdirSync(inputDir, { recursive: true })
    const inputPath = join(inputDir, '保真样例.docx')
    copyFileSync(fixtureFile, inputPath)

    const tasks = new Map<string, TaskHandler<unknown, unknown>>()
    const settings = new Map<string, unknown>()
    const ctx: MainPluginContext = {
      toolId: manifest.id,
      manifest,
      registerIpc: () => undefined,
      registerTask: <P, R>(action: string, handler: TaskHandler<P, R>): void => {
        tasks.set(action, handler as unknown as TaskHandler<unknown, unknown>)
      },
      settings: {
        get: async <T>(key: string, defaultValue: T): Promise<T> =>
          settings.has(key) ? (settings.get(key) as T) : defaultValue,
        set: async (key, value) => {
          settings.set(key, value)
        }
      },
      log: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      },
      paths: { temp: tempRoot, userData: userDataRoot }
    }
    registerWith(ctx, deps)

    const handler = mustGet(tasks, 'convert')
    const result = (await handler({
      toolId: manifest.id,
      action: 'convert',
      payload: { inputPath },
      taskId: 'integration-1',
      signal: new AbortController().signal,
      emit: () => undefined
    })) as { outputPath: string }

    expect(existsSync(result.outputPath)).toBe(true)
    const text = await extractPdfText(result.outputPath)
    expect(text).toContain('保真样例标题')
    expect(text).toContain('表头甲')
    expect(text).toContain('数据一行')
    expect(text).toContain('收尾段落')
    expect(text).toContain('保真样例页眉')
  }, 120_000)
})
