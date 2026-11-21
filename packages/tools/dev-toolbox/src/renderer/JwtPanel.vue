<script setup lang="ts">
// JWT 解码页签（M45）：纯 renderer 解码 header/payload 与时效，不验签、不联网
// 作者：cuilanchao · 修改时间：2026-11-21
import { computed, onUnmounted, ref, watch } from 'vue'
import { NAlert, NButton, NInput, NTag, NText } from 'naive-ui'
import { Copy } from '@lucide/vue'
import { toStructuredError, type StructuredError } from '@lumin/shared'
import { decodeJwt, formatJwtTime, type JwtDecoded } from '../jwt'

/** 输入 → 解码的防抖（ms） */
const DEBOUNCE_MS = 350

const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6Ikx1bWluIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyNDI2MjJ9.samplesignature'

const input = ref('')
const decoded = ref<JwtDecoded | null>(null)
const error = ref<StructuredError | null>(null)
const copiedKey = ref('')
let timer: ReturnType<typeof setTimeout> | null = null
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const headerJson = computed(() =>
  decoded.value === null ? '' : JSON.stringify(decoded.value.header, null, 2)
)
const payloadJson = computed(() =>
  decoded.value === null ? '' : JSON.stringify(decoded.value.payload, null, 2)
)

/** 时效标签（无 exp 时提示不校验时效） */
const expiry = computed<{ text: string; type: 'success' | 'error' | 'default' }>(() => {
  if (decoded.value === null) return { text: '', type: 'default' }
  if (decoded.value.exp === null) return { text: '无 exp', type: 'default' }
  if (decoded.value.expired) return { text: '已过期', type: 'error' }
  return { text: '未过期', type: 'success' }
})

function decode(): void {
  error.value = null
  if (input.value.trim() === '') {
    decoded.value = null
    return
  }
  try {
    decoded.value = decodeJwt(input.value)
  } catch (err) {
    decoded.value = null
    error.value = toStructuredError(err)
  }
}

function scheduleDecode(): void {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    decode()
  }, DEBOUNCE_MS)
}

function clearInput(): void {
  input.value = ''
  decoded.value = null
  error.value = null
}

function fillSample(): void {
  input.value = SAMPLE
  decode()
}

watch(input, scheduleDecode)

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
    error.value = { code: 'DT_JWT_INVALID', message: '复制失败，请手动选择文本复制' }
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
      <NText depth="2" class="text-sm">JWT</NText>
      <NButton size="tiny" quaternary @click="fillSample">填入示例</NButton>
      <NButton size="tiny" quaternary :disabled="input === ''" @click="clearInput">清空</NButton>
    </div>

    <NInput
      v-model:value="input"
      type="textarea"
      placeholder="粘贴 JWT（header.payload.signature），支持 Bearer 前缀"
      :autosize="{ minRows: 5, maxRows: 12 }"
    />

    <!-- 空态 -->
    <div
      v-if="decoded === null && error === null"
      class="rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border, #e0e0e6)] px-4 py-6"
    >
      <NText depth="2" class="text-sm">
        粘贴 JWT 后自动解码 header 与 payload，并显示 exp/iat
        时效；解码在本机完成，不校验签名、不联网。
      </NText>
    </div>

    <!-- 结果态 -->
    <div v-if="decoded !== null" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <NTag size="small" :type="expiry.type" :bordered="false">{{ expiry.text }}</NTag>
        <NTag size="small" :bordered="false">
          {{ decoded.signaturePresent ? '含签名段（未校验）' : '无签名段' }}
        </NTag>
        <NText v-if="decoded.iat !== null" depth="3" class="text-xs">
          iat：{{ formatJwtTime(decoded.iat) }}
        </NText>
        <NText v-if="decoded.exp !== null" depth="3" class="text-xs">
          exp：{{ formatJwtTime(decoded.exp) }}
        </NText>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <NText depth="2" class="text-sm">Header</NText>
            <NButton
              size="tiny"
              quaternary
              :disabled="headerJson === ''"
              @click="copyText('header', headerJson)"
            >
              <Copy class="mr-1 h-3 w-3" />{{ copiedKey === 'header' ? '已复制' : '复制' }}
            </NButton>
          </div>
          <pre
            class="max-h-60 overflow-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] bg-[var(--lumin-color-bg-elevated, #fafafc)] p-3 font-mono text-xs whitespace-pre"
            >{{ headerJson }}</pre>
        </div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <NText depth="2" class="text-sm">Payload</NText>
            <NButton
              size="tiny"
              quaternary
              :disabled="payloadJson === ''"
              @click="copyText('payload', payloadJson)"
            >
              <Copy class="mr-1 h-3 w-3" />{{ copiedKey === 'payload' ? '已复制' : '复制' }}
            </NButton>
          </div>
          <pre
            class="max-h-60 overflow-auto rounded-[var(--lumin-radius-md)] border border-[var(--lumin-color-border, #e0e0e6)] bg-[var(--lumin-color-bg-elevated, #fafafc)] p-3 font-mono text-xs whitespace-pre"
            >{{ payloadJson }}</pre>
        </div>
      </div>
    </div>

    <!-- 报错态 -->
    <NAlert v-if="error !== null" type="error" :bordered="false" title="无法解码">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm">{{ error.message }}（{{ error.code }}）</span>
        <NButton size="tiny" @click="decode">重试</NButton>
      </div>
      <p v-if="error.detail !== undefined" class="mt-1 break-all text-xs">{{ error.detail }}</p>
    </NAlert>

    <NText depth="3" class="text-xs">
      仅解码展示，不做签名校验，请勿据此判断 token 是否可信。
    </NText>
  </div>
</template>
