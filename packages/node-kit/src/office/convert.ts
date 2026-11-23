import { basename, extname, join } from 'node:path'
import { errnoCode } from '@lumin/shared'
import { classifyPrecheckError } from '../precheck'

/** 读权限 + 占用探测（注入 fs 包装） */
export interface PrecheckDeps {
  /** fs.access(path, R_OK) 失败即不可读 */
  checkReadable: (path: string) => Promise<void>
  /** 读方式打开（'r'）失败多半是被其他程序独占（EBUSY/EPERM）；只读文件不受影响 */
  checkExclusive: (path: string) => Promise<void>
}

/** 输入预检结果（调用方按 kind 映射各自工具的结构化错误码） */
export type PrecheckOutcome =
  { ok: true } | { ok: false; kind: 'locked' | 'not-found'; detail: string }

function precheckFailure(err: unknown): PrecheckOutcome {
  return {
    ok: false,
    kind: classifyPrecheckError(err) === 'locked' ? 'locked' : 'not-found',
    detail: errnoCode(err)
  }
}

/** 转换前输入预检：存在可读 + 未被独占 */
export async function precheckInput(
  inputPath: string,
  deps: PrecheckDeps
): Promise<PrecheckOutcome> {
  try {
    await deps.checkReadable(inputPath)
  } catch (err) {
    return precheckFailure(err)
  }
  try {
    await deps.checkExclusive(inputPath)
  } catch (err) {
    return precheckFailure(err)
  }
  return { ok: true }
}

/** 目录 → file:// URL（LibreOffice -env:UserInstallation 用；反斜杠转正斜杠并编码） */
export function toFileUrl(dir: string): string {
  const normalized = dir.replace(/\\/g, '/')
  const withRoot = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://${encodeURI(withRoot).replace(/#/g, '%23')}`
}

/**
 * soffice 转换参数（spike 实测定型）：
 * 独立 profile（防并发串扰）→ headless → 转 pdf → 输出目录 → 输入文件。
 */
export function buildConvertArgs(options: {
  inputPath: string
  outDir: string
  profileDir: string
}): string[] {
  const { inputPath, outDir, profileDir } = options
  return [
    `-env:UserInstallation=${toFileUrl(profileDir)}`,
    '--headless',
    '--norestore',
    '--convert-to',
    'pdf',
    '--outdir',
    outDir,
    inputPath
  ]
}

/** 入口文件校验：必须是 soffice.com / soffice.exe，否则返回 null（由调用方映射错误码） */
export function pickSofficeCommand(sofficePath: string): string | null {
  return /\.(com|exe)$/i.test(sofficePath) ? sofficePath : null
}

/** soffice 产物路径：`{输入基名}.pdf`（写入 outDir） */
export function producedPdfPath(outDir: string, inputPath: string): string {
  const name = basename(inputPath, extname(inputPath))
  return join(outDir, `${name}.pdf`)
}

/** 产物头 5 字节须为 `%PDF-`（假成功/空文件判定） */
export async function verifyPdfOutput(
  pdfPath: string,
  readHead: (path: string) => Promise<string>
): Promise<boolean> {
  try {
    const head = await readHead(pdfPath)
    return head.startsWith('%PDF-')
  } catch {
    return false
  }
}

/** 移动文件系统操作（注入便于测试；生产用 node:fs/promises） */
export interface MoveFs {
  rename: (from: string, to: string) => Promise<void>
  copyFile: (from: string, to: string) => Promise<void>
  unlink: (path: string) => Promise<void>
}

/**
 * 产物从工作目录移到目标路径（跨盘 EXDEV 时回退 copy+unlink）。
 * 目标已由命名模块保证不冲突。
 */
export async function moveFile(from: string, to: string, fs: MoveFs): Promise<void> {
  try {
    await fs.rename(from, to)
  } catch (err) {
    if (errnoCode(err) !== 'EXDEV') throw err
    await fs.copyFile(from, to)
    await fs.unlink(from)
  }
}

/** 每任务独立工作目录（finally 清理；prefix 供各工具区分） */
export function taskWorkDir(tempRoot: string, taskId: string, prefix = 'lumin-office'): string {
  return join(tempRoot, `${prefix}-${taskId}`)
}

/** 失败时截取 stderr/stdout 尾部做 detail（spec §5） */
export function convertDetail(stderr: string, stdout: string): string {
  const text = [stderr, stdout].filter((part) => part.trim() !== '').join('\n')
  return text.trim()
}

/** stderr 嗅探：LibreOffice 明确的「源文件无法加载」文案 */
export function isLoadFailure(stderr: string): boolean {
  return /source file could not be loaded/i.test(stderr)
}

/** 通用失败归类：源文件无法加载 / 其余转换失败（调用方映射自身错误码） */
export type ConvertFailureKind = 'load' | 'convert'

export function classifyConvertFailure(stderr: string): ConvertFailureKind {
  return isLoadFailure(stderr) ? 'load' : 'convert'
}
