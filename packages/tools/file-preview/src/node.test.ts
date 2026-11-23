import type { MainPluginContext } from '@lumin/plugin-api'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SpawnError,
  type RunProcessResult
} from '@lumin/node-kit'
import type { PdfDocumentHandle, RenderedCanvas } from '@lumin/node-kit/pdf'
import type { TaskUpdate } from '@lumin/shared'
import { describe, expect, it, vi } from 'vitest'
import { toolError } from './errors'
import type {
  ConvertOfficeResult,
  InspectResult,
  ReleasePreviewResult,
  RenderPdfPageResult
} from './schema'
import {
  cleanupTempPdfs,
  createNodeDeps,
  decodeTextBytes,
  isStaleTemp,
  newPreviewId,
  previewTempDir,
  registerMain,
  registerWith,
  tempPdfPath,
  type FilePreviewDeps
} from './node'

type IpcHandler = (args: { payload: unknown }) => Promise<unknown>
type TaskHandler = (args: {
  payload: unknown
  taskId: string
  signal: AbortSignal
  emit: (update: TaskUpdate) => void
}) => Promise<unknown>

interface Harness {
  ctx: MainPluginContext
  ipc: Map<string, IpcHandler>
  tasks: Map<string, TaskHandler>
  settings: Map<string, unknown>
}

function makeCtx(): Harness {
  const ipc = new Map<string, IpcHandler>()
  const tasks = new Map<string, TaskHandler>()
  const settings = new Map<string, unknown>()
  const ctx = {
    toolId: 'file-preview',
    manifest: { id: 'file-preview' },
    registerIpc: (action: string, handler: IpcHandler) => {
      ipc.set(action, handler)
    },
    registerTask: (action: string, handler: TaskHandler) => {
      tasks.set(action, handler)
    },
    settings: {
      get: async (key: string, fallback: unknown) =>
        settings.has(key) ? settings.get(key) : fallback,
      set: async (key: string, value: unknown) => {
        settings.set(key, value)
      }
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    paths: { temp: 'C:\\temp', userData: 'C:\\user', binaries: 'C:\\bin' }
  } as unknown as MainPluginContext
  return { ctx, ipc, tasks, settings }
}

function getIpc(harness: Harness, name: string): IpcHandler {
  const handler = harness.ipc.get(name)
  if (handler === undefined) throw new Error(`ipc ${name} 未注册`)
  return handler
}

function getTask(harness: Harness, name: string): TaskHandler {
  const handler = harness.tasks.get(name)
  if (handler === undefined) throw new Error(`task ${name} 未注册`)
  return handler
}

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code })
}

const OK_RUN: RunProcessResult = {
  code: 0,
  signal: null,
  stdout: '',
  stderr: '',
  timedOut: false,
  aborted: false,
  truncated: false
}

function makeDoc(pageCount = 3): { doc: PdfDocumentHandle; cleanup: ReturnType<typeof vi.fn> } {
  const cleanup = vi.fn(async () => undefined)
  return {
    doc: {
      numPages: pageCount,
      getPage: async () => {
        throw new Error('not used')
      },
      cleanup
    },
    cleanup
  }
}

const RENDERED: RenderedCanvas = {
  canvas: {} as unknown as RenderedCanvas['canvas'],
  width: 200,
  height: 300
}

function makeDeps(overrides: Partial<FilePreviewDeps> = {}): FilePreviewDeps {
  return {
    now: () => 1_000_000,
    listDir: async () => [],
    statSync: () => ({ mtimeMs: 0, isFile: () => true }),
    unlink: async () => undefined,
    stat: async () => ({ size: 10, isFile: () => true }),
    readBytes: async () => new TextEncoder().encode('hello'),
    openPdf: async () => ({ doc: makeDoc().doc, pageCount: 3 }),
    renderPage: async () => RENDERED,
    encodePng: async () => Buffer.from([1, 2, 3]),
    fileExists: () => true,
    queryRegistry: async () => null,
    runProcess: async () => OK_RUN,
    checkReadable: async () => undefined,
    checkExclusive: async () => undefined,
    makeDir: async () => undefined,
    removeDir: async () => undefined,
    move: {
      rename: async () => undefined,
      copyFile: async () => undefined,
      unlink: async () => undefined
    },
    readHead: async () => '%PDF-1.7',
    ...overrides
  }
}

describe('纯函数 helpers', () => {
  it('临时目录与任务 PDF 路径', () => {
    expect(previewTempDir('C:\\temp')).toContain('lumin-file-preview')
    expect(tempPdfPath('C:\\temp', 'task-1')).toContain('task-1.pdf')
  })

  it('previewId 前缀且唯一', () => {
    const first = newPreviewId()
    expect(first.startsWith('fp-')).toBe(true)
    expect(first).not.toBe(newPreviewId())
  })

  it('过期判定边界（严格大于）', () => {
    expect(isStaleTemp(0, 1_000, 1_000)).toBe(false)
    expect(isStaleTemp(0, 1_001, 1_000)).toBe(true)
  })

  it('decodeTextBytes 支持 UTF-8/BOM/UTF-16/GBK', () => {
    expect(decodeTextBytes(new TextEncoder().encode('hi'), 'utf8')).toBe('hi')
    expect(decodeTextBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), 'utf8-bom')).toBe('a')
    expect(decodeTextBytes(new Uint8Array([0x41, 0x00]), 'utf16le')).toBe('A')
    expect(decodeTextBytes(new Uint8Array([0x00, 0x41]), 'utf16be')).toBe('A')
    expect(decodeTextBytes(new Uint8Array([0xd6, 0xd0]), 'gbk')).toBe('中')
  })
})

describe('cleanupTempPdfs', () => {
  it('只删 >24h 的 PDF，跳过非 PDF/新文件', async () => {
    const unlink = vi.fn(async () => undefined)
    const removed = await cleanupTempPdfs('C:\\temp\\lumin-file-preview', {
      now: () => 25 * 60 * 60 * 1000,
      listDir: async () => ['old.pdf', 'new.pdf', 'note.txt', 'OLDER.PDF'],
      statSync: (path) =>
        path.toLowerCase().includes('old')
          ? { mtimeMs: 0, isFile: () => true }
          : { mtimeMs: 24 * 60 * 60 * 1000 + 1, isFile: () => true },
      unlink
    })
    expect(removed).toBe(2)
    expect(unlink).toHaveBeenCalledTimes(2)
  })

  it('目录不存在/单项异常时静默', async () => {
    const removed = await cleanupTempPdfs('C:\\missing', {
      now: () => 0,
      listDir: async () => {
        throw errnoError('ENOENT')
      },
      statSync: () => {
        throw errnoError('ENOENT')
      },
      unlink: async () => undefined
    })
    expect(removed).toBe(0)
  })
})

describe('inspect', () => {
  it('文本文件返回类型/扩展名/名称/体积', async () => {
    const harness = makeCtx()
    registerWith(harness.ctx, makeDeps())
    const result = (await getIpc(harness, 'inspect')({
      payload: { path: 'C:\\文档\\说明.TXT' }
    })) as InspectResult
    expect(result).toMatchObject({
      kind: 'text',
      ext: 'txt',
      name: '说明.TXT',
      size: 10
    })
    expect(result.previewId.startsWith('fp-')).toBe(true)
  })

  it('不支持类型 → FP_UNSUPPORTED', async () => {
    const harness = makeCtx()
    registerWith(harness.ctx, makeDeps())
    await expect(
      getIpc(harness, 'inspect')({ payload: { path: 'C:\\a.exe' } })
    ).rejects.toMatchObject({ code: 'FP_UNSUPPORTED' })
  })

  it('不存在 → FP_NOT_FOUND；非文件 → FP_INVALID_PATH', async () => {
    const missing = makeCtx()
    registerWith(
      missing.ctx,
      makeDeps({
        stat: async () => {
          throw errnoError('ENOENT')
        }
      })
    )
    await expect(
      getIpc(missing, 'inspect')({ payload: { path: 'C:\\a.txt' } })
    ).rejects.toMatchObject({ code: 'FP_NOT_FOUND' })

    const dir = makeCtx()
    registerWith(dir.ctx, makeDeps({ stat: async () => ({ size: 0, isFile: () => false }) }))
    await expect(
      getIpc(dir, 'inspect')({ payload: { path: 'C:\\a.txt' } })
    ).rejects.toMatchObject({ code: 'FP_INVALID_PATH' })
  })

  it('PDF 加密 → FP_PDF_PASSWORD', async () => {
    const harness = makeCtx()
    registerWith(
      harness.ctx,
      makeDeps({
        openPdf: async () => {
          throw Object.assign(new Error('need password'), { name: 'PasswordException' })
        }
      })
    )
    await expect(
      getIpc(harness, 'inspect')({ payload: { path: 'C:\\a.pdf' } })
    ).rejects.toMatchObject({ code: 'FP_PDF_PASSWORD' })
  })
})

describe('read-text', () => {
  it('返回编码/EOL 与截断标志', async () => {
    const harness = makeCtx()
    registerWith(
      harness.ctx,
      makeDeps({
        stat: async () => ({ size: 13, isFile: () => true }),
        readBytes: async () => new TextEncoder().encode('hello\r\nworld')
      })
    )
    const result = (await getIpc(harness, 'read-text')({
      payload: { path: 'C:\\a.txt' }
    })) as { text: string; encoding: string; eol: string; truncated: boolean }
    expect(result).toMatchObject({ text: 'hello\r\nworld', encoding: 'utf8', eol: '\r\n' })
    expect(result.truncated).toBe(false)
  })

  it('超过读取上限 → truncated=true', async () => {
    const harness = makeCtx()
    registerWith(
      harness.ctx,
      makeDeps({
        stat: async () => ({ size: 100, isFile: () => true }),
        readBytes: async () => new TextEncoder().encode('short')
      })
    )
    const result = (await getIpc(harness, 'read-text')({
      payload: { path: 'C:\\a.txt', maxBytes: 4 }
    })) as { truncated: boolean }
    expect(result.truncated).toBe(true)
  })

  it('二进制类型 → FP_UNSUPPORTED；占用 → FP_LOCKED', async () => {
    const binary = makeCtx()
    registerWith(binary.ctx, makeDeps())
    await expect(
      getIpc(binary, 'read-text')({ payload: { path: 'C:\\a.pdf' } })
    ).rejects.toMatchObject({ code: 'FP_UNSUPPORTED' })

    const locked = makeCtx()
    registerWith(
      locked.ctx,
      makeDeps({
        readBytes: async () => {
          throw errnoError('EACCES')
        }
      })
    )
    await expect(
      getIpc(locked, 'read-text')({ payload: { path: 'C:\\a.txt' } })
    ).rejects.toMatchObject({ code: 'FP_LOCKED' })
  })
})

describe('asset-url', () => {
  it('图片返回 file:// URL，非图片拒绝', async () => {
    const harness = makeCtx()
    registerWith(harness.ctx, makeDeps())
    const result = (await getIpc(harness, 'asset-url')({
      payload: { path: 'C:\\图\\a.png' }
    })) as { url: string }
    expect(result.url.startsWith('file:///')).toBe(true)
    expect(result.url).toContain('a.png')

    await expect(
      getIpc(harness, 'asset-url')({ payload: { path: 'C:\\a.txt' } })
    ).rejects.toMatchObject({ code: 'FP_UNSUPPORTED' })
  })
})

describe('render / release PDF 会话', () => {
  it('inspect 登记 → 渲染页 → 释放会话', async () => {
    const harness = makeCtx()
    const { doc, cleanup } = makeDoc(3)
    registerWith(harness.ctx, makeDeps({ openPdf: async () => ({ doc, pageCount: 3 }) }))
    const inspected = (await getIpc(harness, 'inspect')({
      payload: { path: 'C:\\a.pdf' }
    })) as InspectResult
    expect(inspected.pageCount).toBe(3)

    const rendered = (await getIpc(harness, 'render-pdf-page')({
      payload: { previewId: inspected.previewId, page: 1 }
    })) as RenderPdfPageResult
    expect(rendered).toEqual({
      png: Buffer.from([1, 2, 3]).toString('base64'),
      width: 200,
      height: 300
    })

    const released = (await getIpc(harness, 'release-preview')({
      payload: { previewId: inspected.previewId }
    })) as ReleasePreviewResult
    expect(released).toEqual({ released: true })
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('未知会话/越界页码 → FP_PDF_RENDER_FAILED', async () => {
    const harness = makeCtx()
    const { doc } = makeDoc(2)
    registerWith(harness.ctx, makeDeps({ openPdf: async () => ({ doc, pageCount: 2 }) }))
    await expect(
      getIpc(harness, 'render-pdf-page')({ payload: { previewId: 'fp-missing', page: 1 } })
    ).rejects.toMatchObject({ code: 'FP_PDF_RENDER_FAILED' })

    const inspected = (await getIpc(harness, 'inspect')({
      payload: { path: 'C:\\a.pdf' }
    })) as InspectResult
    await expect(
      getIpc(harness, 'render-pdf-page')({
        payload: { previewId: inspected.previewId, page: 9 }
      })
    ).rejects.toMatchObject({ code: 'FP_PDF_RENDER_FAILED' })
  })

  it('释放未知会话返回 released=false', async () => {
    const harness = makeCtx()
    registerWith(harness.ctx, makeDeps())
    await expect(
      getIpc(harness, 'release-preview')({ payload: { previewId: 'fp-none' } })
    ).resolves.toEqual({ released: false })
  })
})

describe('soffice-status / set-soffice-path', () => {
  it('无自定义且注册表/便携缺失 → found=false', async () => {
    const harness = makeCtx()
    registerWith(harness.ctx, makeDeps({ fileExists: () => false }))
    await expect(getIpc(harness, 'soffice-status')({ payload: {} })).resolves.toEqual({
      found: false
    })
  })

  it('保存自定义路径后立即可见', async () => {
    const harness = makeCtx()
    const custom = 'C:\\LibreOffice\\program\\soffice.com'
    registerWith(harness.ctx, makeDeps({ fileExists: (path) => path === custom }))
    await expect(
      getIpc(harness, 'set-soffice-path')({ payload: { path: custom } })
    ).resolves.toEqual({ found: true, path: custom })
    expect(harness.settings.get('sofficePath')).toBe(custom)
  })
})

describe('convert-office task', () => {
  const SOFFICE = 'C:\\LibreOffice\\program\\soffice.com'

  function convertHarness(overrides: Partial<FilePreviewDeps> = {}): Harness {
    const harness = makeCtx()
    harness.settings.set('sofficePath', SOFFICE)
    registerWith(
      harness.ctx,
      makeDeps({ fileExists: (path) => path === SOFFICE, ...overrides })
    )
    return harness
  }

  const taskArgs = {
    taskId: 'task-1',
    signal: new AbortController().signal
  }

  it('成功：移动产物、打开 PDF 并返回页数', async () => {
    const rename = vi.fn(async (_from: string, _to: string) => undefined)
    const removeDir = vi.fn(async () => undefined)
    const makeDir = vi.fn(async () => undefined)
    const harness = convertHarness({
      move: { rename, copyFile: async () => undefined, unlink: async () => undefined },
      removeDir,
      makeDir,
      openPdf: async () => ({ doc: makeDoc(5).doc, pageCount: 5 })
    })
    const emit = vi.fn()
    const result = (await getTask(harness, 'convert-office')({
      ...taskArgs,
      payload: { path: 'C:\\文档\\报告.docx' },
      emit
    })) as ConvertOfficeResult
    expect(result.pageCount).toBe(5)
    expect(result.previewId.startsWith('fp-')).toBe(true)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename.mock.calls[0]?.[1]).toContain('task-1.pdf')
    expect(makeDir).toHaveBeenCalled()
    expect(removeDir).toHaveBeenCalled()
    expect(emit).toHaveBeenCalled()
  })

  it('非 Office 类型 → FP_UNSUPPORTED', async () => {
    const harness = convertHarness()
    await expect(
      getTask(harness, 'convert-office')({
        ...taskArgs,
        payload: { path: 'C:\\a.txt' },
        emit: vi.fn()
      })
    ).rejects.toMatchObject({ code: 'FP_UNSUPPORTED' })
  })

  it('输入被占用 → FP_LOCKED', async () => {
    const harness = convertHarness({
      checkExclusive: async () => {
        throw errnoError('EBUSY')
      }
    })
    await expect(
      getTask(harness, 'convert-office')({
        ...taskArgs,
        payload: { path: 'C:\\a.docx' },
        emit: vi.fn()
      })
    ).rejects.toMatchObject({ code: 'FP_LOCKED' })
  })

  it('soffice 缺失 → FP_SOFFICE_MISSING 且清理临时 PDF', async () => {
    const unlink = vi.fn(async () => undefined)
    const harness = makeCtx()
    registerWith(harness.ctx, makeDeps({ fileExists: () => false, unlink }))
    await expect(
      getTask(harness, 'convert-office')({
        ...taskArgs,
        payload: { path: 'C:\\a.docx' },
        emit: vi.fn()
      })
    ).rejects.toMatchObject({ code: 'FP_SOFFICE_MISSING' })
    expect(unlink).toHaveBeenCalled()
  })

  it('超时 → FP_CONVERT_TIMEOUT', async () => {
    const harness = convertHarness({
      runProcess: async () => ({ ...OK_RUN, timedOut: true })
    })
    await expect(
      getTask(harness, 'convert-office')({
        ...taskArgs,
        payload: { path: 'C:\\a.docx' },
        emit: vi.fn()
      })
    ).rejects.toMatchObject({ code: 'FP_CONVERT_TIMEOUT' })
  })

  it('取消 → 抛 aborted', async () => {
    const harness = convertHarness({
      runProcess: async () => ({ ...OK_RUN, aborted: true })
    })
    await expect(
      getTask(harness, 'convert-office')({
        ...taskArgs,
        payload: { path: 'C:\\a.docx' },
        emit: vi.fn()
      })
    ).rejects.toThrow('aborted')
  })

  it('soffice 源文件加载失败 → FP_CONVERT_FAILED', async () => {
    const harness = convertHarness({
      runProcess: async () => ({
        ...OK_RUN,
        code: 1,
        stderr: 'Error: source file could not be loaded'
      })
    })
    await expect(
      getTask(harness, 'convert-office')({
        ...taskArgs,
        payload: { path: 'C:\\a.docx' },
        emit: vi.fn()
      })
    ).rejects.toMatchObject({ code: 'FP_CONVERT_FAILED', detail: '源文件无法加载' })
  })

  it('产物校验失败 → FP_CONVERT_FAILED', async () => {
    const harness = convertHarness({ readHead: async () => 'NOT-PDF' })
    await expect(
      getTask(harness, 'convert-office')({
        ...taskArgs,
        payload: { path: 'C:\\a.docx' },
        emit: vi.fn()
      })
    ).rejects.toMatchObject({ code: 'FP_CONVERT_FAILED' })
  })

  it('spawn 失败 → FP_CONVERT_FAILED', async () => {
    const harness = convertHarness({
      runProcess: async () => {
        throw new SpawnError('spawn failed', SOFFICE)
      }
    })
    await expect(
      getTask(harness, 'convert-office')({
        ...taskArgs,
        payload: { path: 'C:\\a.docx' },
        emit: vi.fn()
      })
    ).rejects.toMatchObject({ code: 'FP_CONVERT_FAILED' })
  })

  it('产物 PDF 加密 → FP_PDF_PASSWORD 并清理临时文件', async () => {
    const unlink = vi.fn(async () => undefined)
    const harness = convertHarness({
      unlink,
      openPdf: async () => {
        throw Object.assign(new Error('password'), { name: 'PasswordException' })
      }
    })
    await expect(
      getTask(harness, 'convert-office')({
        ...taskArgs,
        payload: { path: 'C:\\a.docx' },
        emit: vi.fn()
      })
    ).rejects.toMatchObject({ code: 'FP_PDF_PASSWORD' })
    expect(unlink).toHaveBeenCalled()
  })
})

describe('错误分支补充', () => {
  it('参数校验失败 → INVALID_PAYLOAD', async () => {
    const harness = makeCtx()
    registerWith(harness.ctx, makeDeps())
    await expect(getIpc(harness, 'inspect')({ payload: {} })).rejects.toMatchObject({
      code: 'INVALID_PAYLOAD'
    })
  })

  it('inspect: 已结构化/普通 PDF 打开错误', async () => {
    const structured = makeCtx()
    registerWith(
      structured.ctx,
      makeDeps({
        openPdf: async () => {
          throw toolError('FP_READ_FAILED', 'bad pdf')
        }
      })
    )
    await expect(
      getIpc(structured, 'inspect')({ payload: { path: 'C:\\a.pdf' } })
    ).rejects.toMatchObject({ code: 'FP_READ_FAILED', detail: 'bad pdf' })

    const generic = makeCtx()
    registerWith(
      generic.ctx,
      makeDeps({
        openPdf: async () => {
          throw new Error('corrupted')
        }
      })
    )
    await expect(
      getIpc(generic, 'inspect')({ payload: { path: 'C:\\a.pdf' } })
    ).rejects.toMatchObject({ code: 'FP_READ_FAILED' })
  })

  it('read-text: stat 缺失/读取未知错误/解码失败', async () => {
    const missing = makeCtx()
    registerWith(
      missing.ctx,
      makeDeps({
        stat: async () => {
          throw errnoError('ENOENT')
        }
      })
    )
    await expect(
      getIpc(missing, 'read-text')({ payload: { path: 'C:\\a.txt' } })
    ).rejects.toMatchObject({ code: 'FP_NOT_FOUND' })

    const readFailure = makeCtx()
    registerWith(
      readFailure.ctx,
      makeDeps({
        readBytes: async () => {
          throw errnoError('EIO')
        }
      })
    )
    await expect(
      getIpc(readFailure, 'read-text')({ payload: { path: 'C:\\a.txt' } })
    ).rejects.toMatchObject({ code: 'FP_READ_FAILED' })

    const decodeFailure = makeCtx()
    registerWith(decodeFailure.ctx, makeDeps())
    vi.stubGlobal(
      'TextDecoder',
      class {
        decode(): string {
          throw new Error('unsupported encoding')
        }
      }
    )
    try {
      await expect(
        getIpc(decodeFailure, 'read-text')({ payload: { path: 'C:\\a.txt' } })
      ).rejects.toMatchObject({ code: 'FP_TEXT_DECODE_FAILED' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('asset-url: 不存在/非文件', async () => {
    const missing = makeCtx()
    registerWith(
      missing.ctx,
      makeDeps({
        stat: async () => {
          throw errnoError('ENOENT')
        }
      })
    )
    await expect(
      getIpc(missing, 'asset-url')({ payload: { path: 'C:\\a.png' } })
    ).rejects.toMatchObject({ code: 'FP_NOT_FOUND' })

    const dir = makeCtx()
    registerWith(dir.ctx, makeDeps({ stat: async () => ({ size: 0, isFile: () => false }) }))
    await expect(
      getIpc(dir, 'asset-url')({ payload: { path: 'C:\\a.png' } })
    ).rejects.toMatchObject({ code: 'FP_INVALID_PATH' })
  })

  it('render: 渲染/编码失败 → FP_PDF_RENDER_FAILED', async () => {
    const renderFail = makeCtx()
    registerWith(
      renderFail.ctx,
      makeDeps({
        renderPage: async () => {
          throw new Error('render boom')
        }
      })
    )
    const inspected = (await getIpc(renderFail, 'inspect')({
      payload: { path: 'C:\\a.pdf' }
    })) as InspectResult
    await expect(
      getIpc(renderFail, 'render-pdf-page')({
        payload: { previewId: inspected.previewId, page: 1 }
      })
    ).rejects.toMatchObject({ code: 'FP_PDF_RENDER_FAILED' })

    const encodeFail = makeCtx()
    registerWith(
      encodeFail.ctx,
      makeDeps({
        encodePng: async () => {
          throw new Error('encode boom')
        }
      })
    )
    const another = (await getIpc(encodeFail, 'inspect')({
      payload: { path: 'C:\\b.pdf' }
    })) as InspectResult
    await expect(
      getIpc(encodeFail, 'render-pdf-page')({
        payload: { previewId: another.previewId, page: 1 }
      })
    ).rejects.toMatchObject({ code: 'FP_PDF_RENDER_FAILED' })
  })

  it('release: 关闭/删除失败仍返回 released=true', async () => {
    const cleanup = vi.fn(async () => {
      throw new Error('cleanup boom')
    })
    const harness = makeCtx()
    harness.settings.set('sofficePath', 'C:\\LibreOffice\\program\\soffice.com')
    registerWith(
      harness.ctx,
      makeDeps({
        fileExists: (path) => path === 'C:\\LibreOffice\\program\\soffice.com',
        unlink: async () => {
          throw new Error('unlink boom')
        },
        openPdf: async () => ({ doc: { ...makeDoc().doc, cleanup }, pageCount: 1 })
      })
    )
    const result = (await getTask(harness, 'convert-office')({
      taskId: 'task-clean',
      signal: new AbortController().signal,
      payload: { path: 'C:\\a.docx' },
      emit: vi.fn()
    })) as ConvertOfficeResult
    await expect(
      getIpc(harness, 'release-preview')({ payload: { previewId: result.previewId } })
    ).resolves.toEqual({ released: true })
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('convert: 预检缺失/非 Spawn 异常/非 load 失败', async () => {
    const notFound = makeCtx()
    notFound.settings.set('sofficePath', 'C:\\LibreOffice\\program\\soffice.com')
    registerWith(
      notFound.ctx,
      makeDeps({
        checkReadable: async () => {
          throw errnoError('ENOENT')
        },
        fileExists: (path) => path === 'C:\\LibreOffice\\program\\soffice.com'
      })
    )
    await expect(
      getTask(notFound, 'convert-office')({
        taskId: 't-missing',
        signal: new AbortController().signal,
        payload: { path: 'C:\\a.docx' },
        emit: vi.fn()
      })
    ).rejects.toMatchObject({ code: 'FP_NOT_FOUND' })

    const genericRun = makeCtx()
    genericRun.settings.set('sofficePath', 'C:\\LibreOffice\\program\\soffice.com')
    registerWith(
      genericRun.ctx,
      makeDeps({
        fileExists: (path) => path === 'C:\\LibreOffice\\program\\soffice.com',
        runProcess: async () => {
          throw new Error('unexpected')
        }
      })
    )
    await expect(
      getTask(genericRun, 'convert-office')({
        taskId: 't-generic',
        signal: new AbortController().signal,
        payload: { path: 'C:\\a.docx' },
        emit: vi.fn()
      })
    ).rejects.toThrow('unexpected')

    const otherFailure = makeCtx()
    otherFailure.settings.set('sofficePath', 'C:\\LibreOffice\\program\\soffice.com')
    registerWith(
      otherFailure.ctx,
      makeDeps({
        fileExists: (path) => path === 'C:\\LibreOffice\\program\\soffice.com',
        runProcess: async () => ({ ...OK_RUN, code: 1, stderr: 'unexpected failure' })
      })
    )
    await expect(
      getTask(otherFailure, 'convert-office')({
        taskId: 't-other',
        signal: new AbortController().signal,
        payload: { path: 'C:\\a.docx' },
        emit: vi.fn()
      })
    ).rejects.toMatchObject({ code: 'FP_CONVERT_FAILED' })
  })

  it('cleanup: 非文件与非 PDF 跳过', async () => {
    const unlink = vi.fn(async () => undefined)
    const removed = await cleanupTempPdfs('C:\\temp\\lumin-file-preview', {
      now: () => 1_000_000,
      listDir: async () => ['dir.pdf', 'ok.pdf'],
      statSync: (path) =>
        path.endsWith('dir.pdf')
          ? { mtimeMs: 0, isFile: () => false }
          : { mtimeMs: 999_000, isFile: () => true },
      unlink
    })
    expect(removed).toBe(0)
    expect(unlink).not.toHaveBeenCalled()
  })
})

describe('createNodeDeps / registerMain', () => {
  it('文件系统依赖可完成读写/移动/清理', async () => {
    const deps = createNodeDeps()
    const dir = await mkdtemp(join(tmpdir(), 'lumin-fp-'))
    try {
      const file = join(dir, 'a.txt')
      await writeFile(file, 'hello world', 'utf8')
      expect(deps.fileExists(file)).toBe(true)
      expect(deps.fileExists(join(dir, 'missing.txt'))).toBe(false)

      const info = await deps.stat(file)
      expect(info.isFile()).toBe(true)
      expect(info.size).toBe(11)
      const bytes = await deps.readBytes(file, 5)
      expect(Buffer.from(bytes).toString('utf8')).toBe('hello')

      await deps.checkReadable(file)
      await deps.checkExclusive(file)

      const sub = join(dir, 'sub')
      await deps.makeDir(sub)
      expect(deps.fileExists(sub)).toBe(true)

      const moved = join(dir, 'b.txt')
      await deps.move.rename(file, moved)
      expect(deps.fileExists(moved)).toBe(true)
      const copied = join(dir, 'c.txt')
      await deps.move.copyFile(moved, copied)
      expect(await deps.readHead(copied)).toBe('hello')

      const listed = await deps.listDir(dir)
      expect(listed).toContain('b.txt')
      expect(listed).toContain('c.txt')
      const statInfo = deps.statSync(moved)
      expect(statInfo.isFile()).toBe(true)
      expect(typeof statInfo.mtimeMs).toBe('number')

      await deps.move.unlink(copied)
      await deps.unlink(moved)
      await deps.removeDir(sub)
      expect(await deps.queryRegistry('HKLM\\SOFTWARE\\LuminMissingTestKey')).toBeNull()
    } finally {
      await deps.removeDir(dir)
    }
  })

  it('registerMain 注册全部通道', () => {
    const harness = makeCtx()
    registerMain(harness.ctx)
    expect(harness.ipc.has('inspect')).toBe(true)
    expect(harness.ipc.has('read-text')).toBe(true)
    expect(harness.tasks.has('convert-office')).toBe(true)
  })
})
