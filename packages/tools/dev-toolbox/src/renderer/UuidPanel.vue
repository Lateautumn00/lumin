<script setup lang="ts">
// UUID / 时间戳 ID 生成页签（M45）：纯 renderer 随机生成，本机完成
// 作者：cuilanchao · 修改时间：2026-11-21
import { computed, onUnmounted, ref } from 'vue'
import { NAlert, NButton, NInputNumber, NText } from 'naive-ui'
import { Copy, RefreshCw } from '@lucide/vue'
import { toStructuredError, type StructuredError } from '@lumin/shared'
import { UUID_MAX_COUNT, generateTimestampId, generateUuids } from '../uuid'

/** 默认生成数量 */
const DEFAULT_COUNT = 5

const count = ref<number>(DEFAULT_COUNT)
const values = ref<string[]>([])
const timestampId = ref('')
const error = ref<StructuredError | null>(null)
const copiedKey = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const output = computed(() => values.value.join('\n'))

function generate(): void {
  error.value = null
  try {
    values.value = generateUuids(count.value ?? DEFAULT_COUNT)
  } catch (err) {
    values.value = []
    error.value = toStructuredError(err)
  }
}

function generateTimestamp(): void {
  timestampId.value = generateTimestampId()
}

async function copyText(key: string, text: string): Promise<void> {
  if (text === '') return
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    if (copiedTimer !== null) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copiedKey.value = ''
    }, 1200)
  } catch {
    error.value = { code: 'DT_INVALID_PAYLOAD', message: '复制失败，请手动选择文本复制' }
  }
}

onUnmounted(() => {
  if (copiedTimer !== null) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- UUID v4 -->
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <NText depth="2" class="text-sm">UUID v4</NText>
        <NInputNumber
          v-model:value="count"
          size="small"
          :min="1"
          :max="UUID_MAX_COUNT"
          :step="1"
          class="w-28"
        />
        <NButton size="tiny" type="primary" @click="generate">
          <RefreshCw class="mr-1 h-3 w-3" />生成
        </NButton>
        <NButton
          size="tiny"
          quaternary
          :disabled="output === ''"
          @click="copyText('uuids', output)"
        >
          <Copy class="mr-1 h-3 w-3" />{{ copiedKey === 'uuids' ? '已复制' : '复制全部' }}
        </NButton>
      </div>

      <pre
        v-if="output !== ''"
        class="max-h-80 overflow-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] bg-[var(--lumin-color-bg-elevated, #fafafc)] p-3 font-mono text-xs whitespace-pre"
        >{{ output }}</pre>
      <div
        v-else
        class="rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border, #e0e0e6)] px-4 py-6"
      >
        <NText depth="2" class="text-sm">
          设置数量后点击「生成」批量得到 RFC 4122 v4 UUID（1–{{ UUID_MAX_COUNT }} 个，本机随机数）。
        </NText>
      </div>
    </div>

    <!-- 时间戳 ID -->
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <NText depth="2" class="text-sm">时间戳 ID</NText>
        <NButton size="tiny" @click="generateTimestamp">
          <RefreshCw class="mr-1 h-3 w-3" />生成
        </NButton>
        <NButton
          size="tiny"
          quaternary
          :disabled="timestampId === ''"
          @click="copyText('timestamp', timestampId)"
        >
          <Copy class="mr-1 h-3 w-3" />{{ copiedKey === 'timestamp' ? '已复制' : '复制' }}
        </NButton>
        <NText v-if="timestampId !== ''" class="font-mono text-sm">{{ timestampId }}</NText>
      </div>
      <NText depth="3" class="text-xs">
        格式 yyyyMMdd-HHmmss-xxxx（本地时间 + 4 位随机后缀），适合做文件名/目录名排序。
      </NText>
    </div>

    <!-- 报错态 -->
    <NAlert v-if="error !== null" type="error" :bordered="false" title="生成失败">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm">{{ error.message }}（{{ error.code }}）</span>
        <NButton size="tiny" @click="generate">重试</NButton>
      </div>
      <p v-if="error.detail !== undefined" class="mt-1 break-all text-xs">{{ error.detail }}</p>
    </NAlert>

    <NText depth="3" class="text-xs">
      随机数优先使用系统加密随机源（crypto.getRandomValues），不向外发送任何数据。
    </NText>
  </div>
</template>
