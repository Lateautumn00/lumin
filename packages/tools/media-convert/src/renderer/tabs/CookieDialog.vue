<script setup lang="ts">
// Cookie 管理弹窗（二期，spec §9.5）：按平台三 Tab 管理，粘贴/浏览器读取双获取，脱敏展示
// 作者：cuilanchao · 修改时间：2026-11-19
import { computed, onUnmounted, ref, watch } from 'vue'
import { NButton, NInput, NModal, NPopconfirm, NSelect, NSpace, NTag, NText } from 'naive-ui'
import { KeyRound } from '@lucide/vue'
import { toStructuredError, type StructuredError, type TaskEvent } from '@lumin/shared'
import {
  cookieImportBrowser,
  cookieList,
  cookieRemove,
  cookieSet,
  type CookiePlatform
} from '../clients/download'

const show = defineModel<boolean>('show', { required: true })

/** 平台 Tab（中文标签） */
const PLATFORM_TABS: Array<{ value: CookiePlatform; label: string }> = [
  { value: 'douyin', label: '抖音' },
  { value: 'bilibili', label: 'B站' },
  { value: 'youtube', label: 'YouTube' }
]

/** 浏览器读取选项（spec §9.3 支持矩阵） */
const BROWSER_OPTIONS = [
  { label: 'Firefox（自动读取）', value: 'firefox' },
  { label: '旧版 Chromium/Edge（v10 加密）', value: 'chromium-legacy' }
] as const

const activeTab = ref<CookiePlatform>('douyin')
const items = ref<Record<CookiePlatform, { cookieCount: number; updatedAt?: number }>>({
  douyin: { cookieCount: 0 },
  bilibili: { cookieCount: 0 },
  youtube: { cookieCount: 0 }
})
const pasteText = ref('')
const importBrowser = ref<'firefox' | 'chromium-legacy'>('firefox')
const saving = ref(false)
const importing = ref(false)
const importProgress = ref<number | null>(null)
const error = ref<StructuredError | null>(null)
const successHint = ref('')

let unsubscribe: (() => void) | null = null
let importTaskId = ''

/** 当前 Tab 的脱敏状态文案 */
const currentStatus = computed(() => {
  const item = items.value[activeTab.value]
  if (item === undefined || item.cookieCount === 0) return '未配置'
  const time = item.updatedAt !== undefined ? ` · ${new Date(item.updatedAt).toLocaleString()}` : ''
  return `已存 ${item.cookieCount} 条${time}`
})

/** 平台是否已配置（控制删除按钮显隐） */
function hasCookie(platform: CookiePlatform): boolean {
  return (items.value[platform]?.cookieCount ?? 0) > 0
}

/** 刷新三平台脱敏列表 */
async function refresh(): Promise<void> {
  try {
    const { items: list } = await cookieList()
    const next = { ...items.value }
    for (const item of list) {
      next[item.platform] = {
        cookieCount: item.cookieCount,
        ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {})
      }
    }
    items.value = next
  } catch (err) {
    error.value = toStructuredError(err)
  }
}

/** 任务事件：浏览器导入进度/终态 */
function onEvent(event: TaskEvent): void {
  if (event.taskId !== importTaskId) return
  if (event.kind === 'progress') {
    importProgress.value =
      event.total !== undefined ? Math.round((event.current / event.total) * 100) : event.current
    return
  }
  if (event.kind === 'log') return
  unsubscribe?.()
  unsubscribe = null
  importTaskId = ''
  importing.value = false
  importProgress.value = null
  if (event.kind === 'done') {
    successHint.value = '浏览器 Cookie 导入成功'
    void refresh()
  } else {
    error.value = event.error
  }
}

/** 保存粘贴内容（三种形态，schema preprocess 不在此层——工具包 parseCookieText 在主进程） */
async function save(): Promise<void> {
  if (pasteText.value.trim() === '') return
  saving.value = true
  error.value = null
  successHint.value = ''
  try {
    const { cookieCount, dropped } = await cookieSet({
      platform: activeTab.value,
      raw: pasteText.value
    })
    successHint.value = `已保存 ${cookieCount} 条${dropped > 0 ? `（丢弃 ${dropped} 行无效内容）` : ''}`
    pasteText.value = ''
    await refresh()
  } catch (err) {
    error.value = toStructuredError(err)
  } finally {
    saving.value = false
  }
}

/** 从浏览器导入（长任务，进度三阶段） */
async function importFromBrowser(): Promise<void> {
  importing.value = true
  error.value = null
  successHint.value = ''
  importProgress.value = 0
  try {
    const { taskId } = await cookieImportBrowser({
      platform: activeTab.value,
      browser: importBrowser.value
    })
    importTaskId = taskId
    unsubscribe = window.lumin.onTaskEvent(onEvent)
  } catch (err) {
    error.value = toStructuredError(err)
    importing.value = false
    importProgress.value = null
  }
}

/** 删除当前平台 Cookie */
async function removeCurrent(): Promise<void> {
  error.value = null
  successHint.value = ''
  try {
    await cookieRemove({ platform: activeTab.value })
    await refresh()
  } catch (err) {
    error.value = toStructuredError(err)
  }
}

watch(show, (visible) => {
  if (visible) {
    error.value = null
    successHint.value = ''
    void refresh()
  } else if (unsubscribe !== null) {
    unsubscribe()
    unsubscribe = null
    importTaskId = ''
  }
})

onUnmounted(() => {
  unsubscribe?.()
})
</script>

<template>
  <NModal v-model:show="show" preset="card" title="Cookie 管理" class="w-[520px]">
    <p class="mb-3 text-xs text-[var(--lumin-color-text-secondary)]">
      配置浏览器 Cookie 后可下载登录可见内容（抖音登录内容、B站大会员画质等）。Cookie
      经系统加密存储，不会明文落盘，也不会出现在日志中。
    </p>

    <!-- 平台选择（按钮组替代 NTabs：更轻量且 e2e 可稳定定位） -->
    <NSpace class="mb-3">
      <NButton
        v-for="tab in PLATFORM_TABS"
        :key="tab.value"
        size="small"
        :type="activeTab === tab.value ? 'primary' : 'default'"
        :secondary="activeTab !== tab.value"
        @click="activeTab = tab.value"
      >
        {{ tab.label }}
      </NButton>
    </NSpace>

    <NSpace vertical :size="12">
      <!-- 空态/状态行（脱敏：仅条数与时间） -->
      <NText depth="3" class="text-xs">
        <KeyRound class="mr-1 inline h-3.5 w-3.5" />{{ currentStatus }}
      </NText>

      <!-- 粘贴框（加载态禁用） -->
      <NInput
        v-model:value="pasteText"
        type="textarea"
        :rows="5"
        placeholder="粘贴浏览器导出的 Cookie：支持 DevTools 的 Cookie 请求头、Netscape 文件内容或 name=value 键值对"
        :disabled="saving || importing"
      />

      <!-- 操作区 -->
      <NSpace align="center">
        <NButton
          type="primary"
          size="small"
          :loading="saving"
          :disabled="importing || pasteText.trim() === ''"
          @click="save"
        >
          保存
        </NButton>
        <NSelect
          v-model:value="importBrowser"
          :options="[...BROWSER_OPTIONS]"
          size="small"
          class="w-56"
          :disabled="importing"
        />
        <NButton size="small" :loading="importing" :disabled="saving" @click="importFromBrowser">
          {{ importing ? `读取中 ${importProgress ?? 0}%` : '从浏览器读取' }}
        </NButton>
        <NPopconfirm
          v-if="hasCookie(activeTab)"
          positive-text="确认"
          @positive-click="removeCurrent"
        >
          <template #trigger>
            <NButton size="small" quaternary type="error" :disabled="saving || importing"
              >删除</NButton
            >
          </template>
          确认删除{{ PLATFORM_TABS.find((t) => t.value === activeTab)?.label }}的 Cookie？
        </NPopconfirm>
      </NSpace>

      <!-- 成功提示 -->
      <NTag v-if="successHint !== ''" type="success" size="small" :bordered="false">{{
        successHint
      }}</NTag>

      <!-- 报错态：结构化错误 → 中文文案 + 详情 -->
      <div
        v-if="error !== null"
        class="rounded border border-[var(--lumin-color-error, #e88080)] p-2"
      >
        <NText type="error" class="text-xs">{{ error.message }}</NText>
        <NText v-if="error.detail !== undefined" depth="3" class="mt-1 block break-all text-xs">{{
          error.detail
        }}</NText>
      </div>
    </NSpace>
  </NModal>
</template>
