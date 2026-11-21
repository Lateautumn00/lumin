/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-20
 * @description time-toolbox 时间工具箱的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：纯 renderer 工具，无 IPC 通道与主进程逻辑 */
export const manifest = defineManifest({
  id: 'time-toolbox',
  name: '时间工具箱',
  description: '时间戳与日期互转、多时区、时长、日历差、倒计时与 Cron 解析',
  icon: 'clock',
  category: 'compute',
  order: 70,
  version: '0.2.0'
})
