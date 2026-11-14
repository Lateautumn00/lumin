import { describe, expect, it } from 'vitest'
import {
  buildConvertArgs,
  convertDetail,
  convertFailureCode,
  isLoadFailure,
  mapPrecheckError,
  moveFile,
  pickSofficeCommand,
  precheckInput,
  producedPdfPath,
  taskWorkDir,
  toFileUrl,
  verifyPdfOutput,
  type MoveFs
} from './convert'

describe('mapPrecheckError', () => {
  it('EBUSY / EPERM / EACCES → INPUT_LOCKED', () => {
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
      expect(mapPrecheckError({ code }).code).toBe('INPUT_LOCKED')
    }
  })

  it('ENOENT 及无 errno → INPUT_NOT_FOUND', () => {
    expect(mapPrecheckError({ code: 'ENOENT' }).code).toBe('INPUT_NOT_FOUND')
    expect(mapPrecheckError(new Error('boom')).code).toBe('INPUT_NOT_FOUND')
  })
})

describe('precheckInput', () => {
  const ok = {
    checkReadable: async (): Promise<void> => undefined,
    checkExclusive: async (): Promise<void> => undefined
  }

  it('双检通过 → 不抛', async () => {
    await expect(precheckInput('a.docx', ok)).resolves.toBeUndefined()
  })

  it('读失败 → 结构化错误（ENOENT → INPUT_NOT_FOUND）', async () => {
    const err = await precheckInput('a.docx', {
      ...ok,
      checkReadable: async () => {
        throw { code: 'ENOENT' }
      }
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'INPUT_NOT_FOUND' })
  })

  it('占用探测失败 → INPUT_LOCKED', async () => {
    const err = await precheckInput('a.docx', {
      ...ok,
      checkExclusive: async () => {
        throw { code: 'EBUSY' }
      }
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'INPUT_LOCKED' })
  })
})

describe('toFileUrl', () => {
  it('反斜杠转正斜杠并补根符', () => {
    expect(toFileUrl('C:\\temp\\prof')).toBe('file:///C:/temp/prof')
  })

  it('空格编码为 %20，# 编码', () => {
    expect(toFileUrl('D:\\我的 目录#a')).toBe(
      'file:///D:/%E6%88%91%E7%9A%84%20%E7%9B%AE%E5%BD%95%23a'
    )
  })

  it('已是正斜杠不重复补根', () => {
    expect(toFileUrl('/home/u/prof')).toBe('file:///home/u/prof')
  })
})

describe('buildConvertArgs', () => {
  it('独立 profile + headless + convert-to pdf + outdir + 输入', () => {
    const args = buildConvertArgs({
      inputPath: 'D:\\in\\a.docx',
      outDir: 'D:\\work',
      profileDir: 'C:\\temp\\prof'
    })
    expect(args[0]).toBe('-env:UserInstallation=file:///C:/temp/prof')
    expect(args).toContain('--headless')
    expect(args).toContain('--convert-to')
    expect(args[args.indexOf('--convert-to') + 1]).toBe('pdf')
    expect(args[args.indexOf('--outdir') + 1]).toBe('D:\\work')
    expect(args.at(-1)).toBe('D:\\in\\a.docx')
  })
})

describe('pickSofficeCommand', () => {
  it('.com / .exe 放行', () => {
    expect(pickSofficeCommand('C:\\lo\\soffice.com')).toBe('C:\\lo\\soffice.com')
    expect(pickSofficeCommand('C:\\lo\\soffice.exe')).toBe('C:\\lo\\soffice.exe')
  })

  it('其他扩展 → SPAWN_FAILED', () => {
    expect(() => pickSofficeCommand('C:\\lo\\soffice.dll')).toThrowError()
    try {
      pickSofficeCommand('C:\\lo\\soffice.dll')
    } catch (err) {
      expect(err).toMatchObject({ code: 'SPAWN_FAILED' })
    }
  })
})

describe('producedPdfPath', () => {
  it('按输入基名生成', () => {
    expect(producedPdfPath('D:\\work', 'D:\\in\\报告.docx')).toBe('D:\\work\\报告.pdf')
    expect(producedPdfPath('D:\\work', 'D:\\in\\old.doc')).toBe('D:\\work\\old.pdf')
  })
})

describe('verifyPdfOutput', () => {
  it('头为 %PDF- → true', async () => {
    expect(await verifyPdfOutput('a.pdf', async () => '%PDF-1.7\n...')).toBe(true)
  })

  it('假产物 → false', async () => {
    expect(await verifyPdfOutput('a.pdf', async () => '<html></html>')).toBe(false)
  })

  it('读取失败（文件不存在）→ false', async () => {
    expect(
      await verifyPdfOutput('a.pdf', async () => {
        throw { code: 'ENOENT' }
      })
    ).toBe(false)
  })
})

describe('moveFile', () => {
  const makeFs = (): MoveFs & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      rename: async (from, to) => {
        calls.push(`rename:${from}->${to}`)
      },
      copyFile: async (from, to) => {
        calls.push(`copy:${from}->${to}`)
      },
      unlink: async (path) => {
        calls.push(`unlink:${path}`)
      }
    }
  }

  it('同盘直接 rename', async () => {
    const fs = makeFs()
    await moveFile('a', 'b', fs)
    expect(fs.calls).toEqual(['rename:a->b'])
  })

  it('EXDEV → copy + unlink 回退', async () => {
    const fs = makeFs()
    const failing: MoveFs = {
      ...fs,
      rename: async () => {
        throw { code: 'EXDEV' }
      }
    }
    await moveFile('a', 'b', failing)
    expect(fs.calls).toEqual(['copy:a->b', 'unlink:a'])
  })

  it('其他错误原样抛出', async () => {
    const fs: MoveFs = {
      rename: async () => {
        throw { code: 'EPERM' }
      },
      copyFile: async () => undefined,
      unlink: async () => undefined
    }
    await expect(moveFile('a', 'b', fs)).rejects.toMatchObject({ code: 'EPERM' })
  })
})

describe('taskWorkDir', () => {
  it('按 taskId 独立目录', () => {
    expect(taskWorkDir('C:\\temp', 't-1')).toBe('C:\\temp\\lumin-docx2pdf-t-1')
  })
})

describe('错误归类', () => {
  it('isLoadFailure 嗅探 soffice 文案', () => {
    expect(isLoadFailure('Error: source file could not be loaded!')).toBe(true)
    expect(isLoadFailure('SOME OTHER ERROR')).toBe(false)
  })

  it('convertFailureCode 分流', () => {
    expect(convertFailureCode('source file could not be loaded')).toBe('INPUT_LOAD_FAILED')
    expect(convertFailureCode('segfault at ...')).toBe('CONVERT_FAILED')
  })

  it('convertDetail 拼接 stderr/stdout，忽略空段', () => {
    expect(convertDetail('err\n', '')).toBe('err')
    expect(convertDetail('', '')).toBe('')
    expect(convertDetail('e', 'o')).toBe('e\no')
  })
})
