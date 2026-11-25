/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-25
 * @description image-toolbox 图片工具箱的 manifest 定义（M72 合并水印/去水印/拼接），icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.image-toolbox.*` 对应 */
export const manifest = defineManifest({
  id: 'image-toolbox',
  name: '图片工具箱',
  description:
    '图片批量压缩、格式转换、缩放、旋转、裁剪、效果调整、GIF 生成、批量水印、去水印与图片拼接（基于 ffmpeg）',
  icon: 'image',
  category: 'image',
  order: 50,
  version: '0.4.0'
})
