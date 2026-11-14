import { basename, extname, join } from 'node:path'
import { toolError, errnoCode, type Docx2pdfErrorCode } from './errors'

/** 读权限 + 占用探测（注入 fs 包装） */
export interface PrecheckDeps {
  /** fs.access(path, R_OK) 失败即不可读 */
  checkReadable: (path: string) => Promise<void>
  /** 读方式打开（'r'）失败多半是被其他程序独占（EBUSY/EPERM）；只读文件不受影响 */
  checkExclusive: (path: string) => Promise<void>
}

const LOCK_ERRNOS = new Set(['EBUSY', 'EPERM', 'EACCES'])

/** 预检 errno → 结构化错误（spec §5：EBUSY/EPERM → 占用，其余 → 不存在） */
export function mapPrecheckError(err: unknown): ReturnType<typeof toolError> {
  return LOCK_ERRNOS.has(errnoCode(err))
    ? toolError('INPUT_LOCKED', errnoCode(err))
    : toolError('INPUT_NOT_FOUND', errnoCode(err))
}

/** 转换前输入预检：存在可读 + 未被独占；失败抛结构化错误 */
export async function precheckInput(inputPath: string, deps: PrecheckDeps): Promise<void> {
  try {
    await deps.checkReadable(inputPath)
  } catch (err) {
    throw mapPrecheckError(err)
  }
  try {
    await deps.checkExclusive(inputPath)
  } catch (err) {
    throw mapPrecheckError(err)
  }
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

/** 入口文件校验：必须是 soffice.com / soffice.exe（否则 SPAWN_FAILED） */
export function pickSofficeCommand(sofficePath: string): string {
  if (!/\.(com|exe)$/i.test(sofficePath)) throw toolError('SPAWN_FAILED', sofficePath)
  return sofficePath
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
 * 目标已由 naming.resolveOutputPath 保证不冲突。
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

/** 每任务独立工作目录（finally 清理） */
export function taskWorkDir(tempRoot: string, taskId: string): string {
  return join(tempRoot, `lumin-docx2pdf-${taskId}`)
}

/** 失败时截取 stderr/stdout 尾部做 detail（spec §5） */
export function convertDetail(stderr: string, stdout: string): string {
  const text = [stderr, stdout].filter((part) => part.trim() !== '').join('\n')
  return text.trim()
}

/** stderr 嗅探：LibreOffice 明确的「源文件无法加载」文案 → INPUT_LOAD_FAILED */
export function isLoadFailure(stderr: string): boolean {
  return /source file could not be loaded/i.test(stderr)
}

/** exit ≠ 0 时的错误码归类 */
export function convertFailureCode(stderr: string): Docx2pdfErrorCode {
  return isLoadFailure(stderr) ? 'INPUT_LOAD_FAILED' : 'CONVERT_FAILED'
}
