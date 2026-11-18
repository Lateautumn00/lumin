/**
 * OCR Tab 共享会话（ToolView 创建并 provide；OcrPreview/OcrPanel inject）。
 * 左右两栏必须读写同一份状态（题区/当前页/选中边界），避免 props 双向透传。
 */
import { inject, ref, type InjectionKey, type Ref } from 'vue'
import type { StructuredError } from '@lumin/shared'
import type { OcrPage, OcrRotation } from '../schema'
import { resetPage, type BoundaryRef } from './ocr-edit'

/** 任务阶段进度（message 由 worker 提供，如「加载识别模型…」） */
export interface OcrProgressState {
  current?: number
  total?: number
  message: string
}

export interface OcrWorkspace {
  /** 已选输入文件（预览经 File 直读） */
  inputFile: Ref<File | null>
  /** 输入真实路径（空串 = 空态；IPC 入参） */
  path: Ref<string>
  /** 输入文件名 */
  name: Ref<string>
  /** 编辑态题区（导出载荷来源） */
  pages: Ref<OcrPage[]>
  /** 自动识别结果（[重置本页] 恢复用） */
  detected: Ref<OcrPage[]>
  /** NO_REGIONS 手动模式 */
  manualMode: Ref<boolean>
  /** 执行中的任务类型（null = 空闲） */
  running: Ref<'detect' | 'export' | null>
  progress: Ref<OcrProgressState | null>
  /** 任务错误（导出/识别） */
  error: Ref<StructuredError | null>
  /** 预览打开错误（PDF 加密/图片解码失败） */
  previewError: Ref<StructuredError | null>
  outputPaths: Ref<string[]>
  /** 当前预览页（1-based） */
  pageNumber: Ref<number>
  /** 选中的分界线 */
  selected: Ref<BoundaryRef | null>
  /** 添加边界模式 */
  adding: Ref<boolean>
  /** 题目列表定位的题区下标（仅当前页） */
  activeRegion: Ref<number | null>
  /** 起始题号输入（NInputNumber 可空） */
  startNumber: Ref<number | null>
  /** 同时合成 PDF */
  exportPdf: Ref<boolean>
  totalPages: Ref<number>
  /** 各页渲染像素尺寸（预览 meta 回填；手动模式建页） */
  pageSizes: Ref<Record<number, { width: number; height: number }>>
  invalidHint: Ref<string>
  /** 页面旋转（顺时针 0/90/180/270，spec §10.12；detect 与 export 同值） */
  rotation: Ref<OcrRotation>
  /** 旋转 90°（delta = ±90）：破坏性，清空识别结果与题区（需重新识别） */
  rotate(delta: 90 | -90): void
  /** [重置本页]：自动页恢复自动结果、手动页清空题区（仅当前页） */
  resetCurrentPage(): void
}

export function createOcrWorkspace(): OcrWorkspace {
  const pages = ref<OcrPage[]>([])
  const detected = ref<OcrPage[]>([])
  const pageNumber = ref(1)
  const selected = ref<BoundaryRef | null>(null)
  const activeRegion = ref<number | null>(null)
  const manualMode = ref(false)
  const adding = ref(false)
  const error = ref<StructuredError | null>(null)
  const outputPaths = ref<string[]>([])
  const pageSizes = ref<Record<number, { width: number; height: number }>>({})
  const rotation = ref<OcrRotation>(0)
  return {
    inputFile: ref<File | null>(null),
    path: ref(''),
    name: ref(''),
    pages,
    detected,
    manualMode,
    running: ref<'detect' | 'export' | null>(null),
    progress: ref<OcrProgressState | null>(null),
    error,
    previewError: ref<StructuredError | null>(null),
    outputPaths,
    pageNumber,
    selected,
    adding,
    activeRegion,
    startNumber: ref<number | null>(1),
    exportPdf: ref(true),
    totalPages: ref(0),
    pageSizes,
    invalidHint: ref(''),
    rotation,
    rotate(delta: 90 | -90): void {
      rotation.value = ((((rotation.value + delta) % 360) + 360) % 360) as OcrRotation
      pages.value = []
      detected.value = []
      manualMode.value = false
      selected.value = null
      activeRegion.value = null
      adding.value = false
      error.value = null
      outputPaths.value = []
      pageSizes.value = {}
      pageNumber.value = 1
    },
    resetCurrentPage(): void {
      pages.value = resetPage(pages.value, detected.value, pageNumber.value)
      selected.value = null
      activeRegion.value = null
    }
  }
}

export const OCR_WORKSPACE: InjectionKey<OcrWorkspace> = Symbol('ocr-workspace')

/** 子组件取会话（ToolView 必须 provide；缺失属接线错误） */
export function useOcrWorkspace(): OcrWorkspace {
  const workspace = inject(OCR_WORKSPACE)
  if (workspace === undefined) throw new Error('OCR workspace 未提供，检查 ToolView provide')
  return workspace
}
