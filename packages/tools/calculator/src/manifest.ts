/**
 * @file manifest.ts 计算器工具清单（M79 合并单位换算与生活计算）
 * @author cuilanchao
 * @date 2026-11-25
 * @description id 保持 `calculator`；显示名「计算器」，含计算 / 进制 / 单位换算 / 生活计算四页签
 */
import { defineManifest } from '@lumin/plugin-api'

export const manifest = defineManifest({
  id: 'calculator',
  name: '计算器',
  description: '科学计算器与进制换算、17 类单位双向换算、房贷/个税/百分比折扣，全部离线本地计算',
  icon: 'calculator',
  category: 'compute',
  order: 10,
  version: '0.3.0'
})
