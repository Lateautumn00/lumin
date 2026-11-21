/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-21
 * @description dev-toolbox 开发工具 manifest，icon 'terminal' 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.dev-toolbox.*` 对应 */
export const manifest = defineManifest({
  id: 'dev-toolbox',
  name: '开发工具',
  description: '端口占用查询与进程结束、CURL 转代码、JWT 解码、UUID 生成、本地静态服务器',
  icon: 'terminal',
  category: 'misc',
  order: 70,
  version: '0.1.0'
})
