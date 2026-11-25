<script setup lang="ts">
/**
 * @file 本地路径可点击链接（单击用系统默认程序打开，等价点击标准 URL）。
 * @author cuilanchao
 * @date 2026-11-25
 * @description 全部产物路径统一走本组件，禁止纯文本路径：路径原样交给主进程
 *              `shell.openPath`（Win/macOS/Linux 由系统分发，不在 renderer 拼
 *              `file://`，规避盘符/中文/空格编码差异）；打开失败退化为「在文件夹中
 *              显示」；`reveal` 控制是否附带定位按钮（行内已有定位按钮时传 false）。
 */
import { computed, ref } from 'vue'
import { FolderOpen } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    /** 本地绝对路径（文件或目录） */
    path: string
    /** 展示文案；缺省显示完整路径 */
    label?: string
    /** 是否显示「在文件夹中显示」按钮（所在行已有定位按钮时置 false） */
    reveal?: boolean
  }>(),
  { reveal: true }
)

const busy = ref(false)
const text = computed(() => props.label ?? props.path)

/** 单击：用系统默认程序打开文件；失败时退化为在文件夹中定位 */
async function open(): Promise<void> {
  if (props.path === '' || busy.value) return
  busy.value = true
  try {
    await window.lumin.openPath(props.path)
  } catch {
    await window.lumin.revealPath(props.path).catch(() => undefined)
  } finally {
    busy.value = false
  }
}

/** 在文件夹中显示（不打开文件） */
async function revealInFolder(): Promise<void> {
  if (props.path === '') return
  await window.lumin.revealPath(props.path).catch(() => undefined)
}
</script>

<template>
  <span v-if="path !== ''" class="inline-flex min-w-0 max-w-full items-center gap-1 align-middle">
    <button
      type="button"
      class="min-w-0 truncate text-left text-[var(--lumin-color-primary)] underline underline-offset-2 hover:text-[var(--lumin-color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lumin-color-primary)] disabled:opacity-60"
      :title="`${path}（单击打开）`"
      :disabled="busy"
      @click="open"
    >
      {{ text }}
    </button>
    <button
      v-if="reveal"
      type="button"
      class="shrink-0 rounded-sm p-0.5 text-[var(--lumin-color-text-secondary)] hover:text-[var(--lumin-color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lumin-color-primary)]"
      title="在文件夹中显示"
      aria-label="在文件夹中显示"
      @click="revealInFolder"
    >
      <FolderOpen :size="14" aria-hidden="true" />
    </button>
  </span>
</template>
