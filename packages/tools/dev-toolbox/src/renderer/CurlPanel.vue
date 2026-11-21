<script setup lang="ts">
// CURL 转代码页签（M42）：纯 renderer 解析 + 生成 fetch/axios/python
// 作者：cuilanchao · 修改时间：2026-11-21
import { computed, onUnmounted, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NRadio, NRadioGroup, NText } from 'naive-ui'
import { Copy } from '@lucide/vue'
import { toStructuredError, type StructuredError } from '@lumin/shared'
import { convertCurl, type CurlTarget } from '../curl'

/** 输入 → 输出的防抖（ms） */
const DEBOUNCE_MS = 350

const SAMPLE = `curl 'https://api.example.com/login' \\
  -H 'X-A: 1' \\
  -H 'Content-Type: application/json' \\
  -d '{"user":"lumin","pass":"123456"}'`

const input = ref('')
const output = ref('')
const target = ref<CurlTarget>('fetch')
const error = ref<StructuredError | null>(null)
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const hasOutput = computed(() => output.value !== '')

function convert(): void {
  error.value = null
  if (input.value.trim() === '') {
    output.value = ''
    return
  }
  try {
    output.value = convertCurl(input.value, target.value)
  } catch (err) {
    output.value = ''
    error.value = toStructuredError(err)
  }
}

function scheduleConvert(): void {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    convert()
  }, DEBOUNCE_MS)
}

watch(input, scheduleConvert)
watch(target, () => {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  convert()
})

function fillSample(): void {
  input.value = SAMPLE
  convert()
}

async function copyOutput(): Promise<void> {
  if (output.value === '') return
  try {
    await navigator.clipboard.writeText(output.value)
    copied.value = true
    if (copiedTimer !== null) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1200)
  } catch {
    error.value = { code: 'DT_CURL_PARSE_FAILED', message: '复制失败，请手动选择文本复制' }
  }
}

onUnmounted(() => {
  if (timer !== null) clearTimeout(timer)
  if (copiedTimer !== null) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <NText depth="2" class="text-sm">输出</NText>
      <NRadioGroup v-model:value="target" size="small">
        <NRadio value="fetch">fetch</NRadio>
        <NRadio value="axios">axios</NRadio>
        <NRadio value="python">python</NRadio>
      </NRadioGroup>
      <NButton size="tiny" quaternary @click="fillSample">填入示例</NButton>
      <NButton size="tiny" quaternary :disabled="!hasOutput" @click="copyOutput">
        <Copy class="mr-1 h-3 w-3" />{{ copied ? '已复制' : '复制代码' }}
      </NButton>
    </div>

    <div class="grid gap-3 md:grid-cols-2">
      <div class="flex flex-col gap-2">
        <NText depth="2" class="text-sm">CURL 命令</NText>
        <NInput
          v-model:value="input"
          type="textarea"
          placeholder="粘贴 curl 命令，例如 curl 'https://api.example.com/x' -H 'X-A: 1'"
          :autosize="{ minRows: 10, maxRows: 18 }"
        />
      </div>
      <div class="flex flex-col gap-2">
        <NText depth="2" class="text-sm">生成代码</NText>
        <pre
          v-if="hasOutput"
          class="max-h-80 min-h-40 overflow-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] bg-[var(--lumin-color-bg-elevated, #fafafc)] p-3 font-mono text-xs whitespace-pre"
          >{{ output }}</pre>
        <div
          v-else
          class="rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border, #e0e0e6)] px-4 py-6"
        >
          <NText depth="2" class="text-sm">
            粘贴 curl 命令后自动生成代码；支持 -X / -H / -d / -b / -A / -u / -I。
          </NText>
        </div>
      </div>
    </div>

    <!-- 报错态 -->
    <NAlert v-if="error !== null" type="error" :bordered="false" title="无法转换">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm">{{ error.message }}（{{ error.code }}）</span>
        <NButton size="tiny" @click="convert">重试</NButton>
      </div>
      <p v-if="error.detail !== undefined" class="mt-1 break-all text-xs">{{ error.detail }}</p>
    </NAlert>

    <NText depth="3" class="text-xs">
      解析在本机完成、不联网；不支持的参数（如 -F 表单上传）会明确报错，请手动改写。
    </NText>
  </div>
</template>
