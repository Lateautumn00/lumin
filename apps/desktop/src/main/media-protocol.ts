/**
 * @file 壳级本地媒体自定义协议（lumin-media://local/<token>）
 * @author cuilanchao
 * @date 2026-11-24
 * @description 开发态 renderer 由 http://localhost 提供，Chromium 的 URL safety check 会拒绝从 http 页面
 *              加载 file:// 媒体（MediaError 4 / SRC_NOT_SUPPORTED）；UNC 网络路径同理。这里注册标准
 *              自定义协议，由主进程校验路径后经 Chromium file 后端流式回源（支持 Range / seek）。
 *              scheme 注册必须在 app ready 前完成，handler 注册必须在 ready 后完成。
 */
import { net, protocol } from 'electron'
import log from 'electron-log'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fromMediaUrl, MEDIA_URL_SCHEME } from '@lumin/shared'

/**
 * app ready 前调用：登记特权 scheme
 * standard 让 host 参与解析，secure 允许被 http 开发源加载，stream 支持流式响应
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_URL_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/**
 * 请求 URL → 本地普通文件绝对路径；非法请求返回 null（协议 handler 回 404）
 * @param requestUrl 渲染进程发起的请求 URL
 */
async function resolveMediaFile(requestUrl: string): Promise<string | null> {
  const decoded = fromMediaUrl(requestUrl)
  if (decoded === null || !isAbsolute(decoded)) return null
  try {
    const info = await stat(decoded)
    return info.isFile() ? decoded : null
  } catch {
    return null
  }
}

/** app ready 后调用：接管 lumin-media 请求 */
export function registerMediaHandler(): void {
  protocol.handle(MEDIA_URL_SCHEME, async (request) => {
    const filePath = await resolveMediaFile(request.url)
    if (filePath === null) {
      return new Response('Not Found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    }
    try {
      // 透传 Range，保证拖动进度条时按 206 分段读取而非整文件重下
      const headers = new Headers()
      const range = request.headers.get('Range')
      if (range !== null) headers.set('Range', range)
      return await net.fetch(pathToFileURL(filePath).href, { headers })
    } catch (err) {
      log.error('媒体协议读取失败', filePath, err)
      return new Response('Internal Error', {
        status: 500,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    }
  })
}
