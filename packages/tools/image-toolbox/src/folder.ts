/**
 * @file folder.ts 文件夹递归收集图片（M63，P1-6；仅主进程）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 迭代遍历目录：按白名单扩展名收集普通文件、跳过符号链接（防环），
 *              最多 MAX_BATCH_FILES 张（触达即停并标记 truncated），结果按路径排序。
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_BATCH_FILES, extensionOf, type CollectFolderResult } from './schema'

/**
 * 递归收集目录内受支持的图片文件
 * @param root 起始目录（绝对路径）
 * @returns 绝对路径列表（排序）与是否因上限截断
 */
export async function collectImages(root: string): Promise<CollectFolderResult> {
  const files: string[] = []
  const stack: string[] = [root]
  let truncated = false
  while (stack.length > 0) {
    const dir = stack.pop()
    if (dir === undefined) break
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (files.length >= MAX_BATCH_FILES) {
        truncated = true
        break
      }
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else if (entry.isFile() && extensionOf(full) !== null) {
        files.push(full)
      }
    }
    if (truncated) break
  }
  files.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
  return { files, truncated }
}
