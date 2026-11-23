/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-23
 * @description calendar 日历的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：纯 renderer 工具，无 IPC 通道与主进程逻辑 */
export const manifest = defineManifest({
  id: 'calendar',
  name: '日历',
  description: '公历/农历/节假日/纪念日/黄历',
  icon: 'calendar-days',
  category: 'compute',
  order: 71,
  version: '0.1.0'
})
