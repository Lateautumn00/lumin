/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-20
 * @description 密码生成器的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：纯 renderer 工具，无 IPC 通道与主进程逻辑 */
export const manifest = defineManifest({
  id: 'password-generator',
  name: '密码生成器',
  description: '强随机密码生成（熵与强度评估）、UUID v4、随机字符串与随机整数',
  icon: 'key-round',
  category: 'misc',
  order: 90,
  version: '0.1.0'
})
