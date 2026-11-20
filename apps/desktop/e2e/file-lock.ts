import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface FileLockHandle {
  /** 独占句柄是否确实生效（轮询 Node 侧读取失败即视为生效） */
  acquired: boolean
  release: () => void
}

/**
 * 用 PowerShell 子进程持有文件独占句柄（FileShare.None）。
 * PowerShell 冷启动可能超过固定等待时长，因此轮询「Node 侧读取该文件失败」
 * 来确认锁真正生效，避免假锁导致占用类用例误判成功。
 */
export async function holdExclusiveLock(
  filePath: string,
  timeoutMs = 15_000
): Promise<FileLockHandle> {
  const scriptPath = path.join(path.dirname(filePath), 'hold.ps1')
  fs.writeFileSync(
    scriptPath,
    "$fs = [System.IO.File]::Open($args[0], 'Open', 'ReadWrite', 'None')\n" +
      'Start-Sleep -Seconds 60\n' +
      '$fs.Close()\n'
  )
  const holder: ChildProcess = spawn(
    'powershell.exe',
    ['-NoProfile', '-File', scriptPath, filePath],
    { windowsHide: true }
  )

  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    try {
      fs.readFileSync(filePath)
    } catch {
      return { acquired: true, release: () => holder.kill() }
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  holder.kill()
  return { acquired: false, release: () => undefined }
}
