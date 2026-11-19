/**
 * @file formats.ts
 * @author cuilanchao
 * @date 2026-11-19
 * @description 输入格式与批量上限常量（零依赖，renderer 与主进程共用，避免把 zod 打进渲染层 chunk）。
 */

/** 输入文件扩展名约束（Word/Excel/PPT，大小写不敏感；soffice 原生支持） */
export const OFFICE_INPUT_RE = /\.(doc|docx|xls|xlsx|ppt|pptx)$/i

/** 文件选择器/拖拽 accept 属性值 */
export const OFFICE_ACCEPT = '.doc,.docx,.xls,.xlsx,.ppt,.pptx'

/** 输入格式中文说明（错误提示与 UI 共用口径） */
export const OFFICE_INPUT_HINT = '.doc/.docx/.xls/.xlsx/.ppt/.pptx'

/** 单次批量提交文件数上限 */
export const MAX_BATCH_FILES = 100
