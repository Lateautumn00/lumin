/**
 * runTask 协议测试 fixture（plain JS：裸 Node worker 无法加载 workspace TS 的无扩展名内部 import）。
 * 按 payload.mode 分支，覆盖 runTask 消费的全部消息形态；真 TS worker 由 e2e 兜底。
 */
import { parentPort } from 'node:worker_threads'

const port = parentPort
if (!port) throw new Error('fixture worker 必须运行在 worker 线程中')

port.once('message', (msg) => {
  const mode = msg?.payload?.mode
  if (mode === 'ok') {
    port.postMessage({ kind: 'progress', current: 1, total: 3, message: '加载', stage: 'load' })
    port.postMessage({ kind: 'log', message: `处理 ${msg.payload.id}` })
    port.postMessage({ kind: 'progress', current: 3, total: 3 })
    port.postMessage({ kind: 'done', value: { echoed: msg.payload, ok: true } })
    return
  }
  if (mode === 'error') {
    port.postMessage({
      kind: 'error',
      error: { code: 'PDF_ENCRYPTED', message: 'PDF 已加密，请先解除密码再操作' }
    })
    return
  }
  if (mode === 'crash') {
    throw new Error('boom')
  }
  if (mode === 'exit') {
    process.exit(7)
    return
  }
  if (mode === 'illegal') {
    port.postMessage({ kind: 'weird' })
    return
  }
  if (mode === 'bad-error') {
    port.postMessage({ kind: 'error', error: { code: 'not-structured' } })
    return
  }
  if (mode === 'hang') {
    // 保持线程存活直至被 terminate（超时/取消用例）
    setInterval(() => {}, 1000)
    return
  }
  port.postMessage({ kind: 'done', value: null })
})
