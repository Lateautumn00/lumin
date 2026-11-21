/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-21
 * @description life-calculator 生活计算器的 manifest 定义，icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：纯 renderer 工具，无 IPC 通道与主进程逻辑 */
export const manifest = defineManifest({
  id: 'life-calculator',
  name: '生活计算器',
  description: '房贷等额本息/等额本金月供与还款计划、工资个税与五险一金、百分比与折扣计算',
  icon: 'piggy-bank',
  category: 'compute',
  order: 30,
  version: '0.1.0'
})
