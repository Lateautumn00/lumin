/**
 * @file 工具清单（AGENTS §7：新增工具 = 新包 + 清单 1 行）
 * @author cuilanchao
 * @date 2026-11-25
 * @description image-toolbox 图片工具箱的 manifest 定义（M72 合并水印/去水印/拼接；M82 合并文字识别/二维码），
 *              icon 需在壳 AppSidebar iconMap 注册
 */
import { defineManifest } from '@lumin/plugin-api'

/** 工具清单：id 与 settings 命名空间 `tools.image-toolbox.*` 对应（子页签 `ocr.*` / `qr.*`） */
export const manifest = defineManifest({
  id: 'image-toolbox',
  name: '图片工具箱',
  description:
    '图片压缩/转换/缩放/旋转/裁剪/调整/GIF/水印/去水印/拼接，以及图片与 PDF 文字识别、二维码生成识别',
  icon: 'image',
  category: 'image',
  order: 50,
  version: '0.5.0'
})
