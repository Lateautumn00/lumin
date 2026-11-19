/**
 * @file 原子写盘（临时文件 + rename；跨工具共用）
 * @author cuilanchao
 * @date 2026-11-19
 * @description 上提自 qr-code save.ts：写 `<target>.tmp-<pid>-<n>` 后 rename，失败时清理临时文件
 *             并透传原始错误（调用方按自身错误码包装）。fs 可注入供单测覆盖失败分支。
 */
import { renameSync, unlinkSync, writeFileSync } from 'node:fs'

/** 原子写盘所需的最小 fs 子集（单测注入假件以覆盖 rename 失败清理） */
export interface AtomicFs {
  writeFileSync: (file: string, data: string | Buffer) => void
  renameSync: (from: string, to: string) => void
  unlinkSync: (file: string) => void
}

const defaultFs: AtomicFs = { writeFileSync, renameSync, unlinkSync }

/** 临时文件序号（同进程内防重名） */
let tempSequence = 0

/**
 * 原子写盘：先写 `<target>.tmp-<pid>-<n>` 再 rename 到目标
 * @param target 目标绝对路径
 * @param data 文件内容（文本或二进制 Buffer）
 * @param fs 可注入 fs 子集（默认 Node 实现）
 */
export function writeAtomic(target: string, data: string | Buffer, fs: AtomicFs = defaultFs): void {
  tempSequence += 1
  const temp = `${target}.tmp-${process.pid}-${tempSequence}`
  fs.writeFileSync(temp, data)
  try {
    fs.renameSync(temp, target)
  } catch (err) {
    try {
      fs.unlinkSync(temp)
    } catch {
      // 临时文件可能未落盘或被占用，忽略清理失败以透传原始写盘错误
    }
    throw err
  }
}
