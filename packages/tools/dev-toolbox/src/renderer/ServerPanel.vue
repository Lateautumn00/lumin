<script setup lang="ts">
// 静态服务器页签（M42）：根目录 + 端口 → 启动/停止，运行中展示地址与最近访问
// 作者：cuilanchao · 修改时间：2026-11-21
import { computed, ref } from 'vue'
import { NButton, NInput, NInputNumber, NSpin, NText } from 'naive-ui'
import { Copy, FolderOpen, Play, Square } from '@lucide/vue'
import type { AccessLog } from '../schema'

const props = defineProps<{
  root: string
  port: number
  status: { running: boolean; port?: number; root?: string; requests: AccessLog[] }
  busy: boolean
}>()

const emit = defineEmits<{
  'update:root': [value: string]
  'update:port': [value: number]
  start: []
  stop: []
}>()

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const address = computed(() => `http://127.0.0.1:${props.status.port ?? props.port}/`)

function selectRoot(): void {
  void (async () => {
    try {
      const picked = await window.lumin.pickDirectory('选择静态服务器根目录')
      if (picked !== null) emit('update:root', picked)
    } catch {
      // 目录选择被取消或失败：保持当前值
    }
  })()
}

function updatePort(value: number | null): void {
  emit('update:port', value ?? 8080)
}

async function copyAddress(): Promise<void> {
  try {
    await navigator.clipboard.writeText(address.value)
    copied.value = true
    if (copiedTimer !== null) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1200)
  } catch {
    // 复制失败保留原按钮文案
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <NInput :value="root" readonly placeholder="根目录（点击右侧选择）" class="min-w-72 flex-1" />
      <NButton :disabled="status.running || busy" @click="selectRoot">
        <FolderOpen class="mr-1 h-4 w-4" />选择目录
      </NButton>
      <NText depth="2" class="text-sm">端口</NText>
      <NInputNumber
        :value="port"
        :min="1"
        :max="65535"
        :disabled="status.running || busy"
        class="w-32"
        @update:value="updatePort"
      />
      <NButton v-if="!status.running" type="primary" :loading="busy" @click="emit('start')">
        <Play v-if="!busy" class="mr-1 h-4 w-4" />启动
      </NButton>
      <NButton v-else type="error" :loading="busy" @click="emit('stop')">
        <Square v-if="!busy" class="mr-1 h-4 w-4" />停止
      </NButton>
    </div>

    <NText depth="3" class="text-xs">
      仅监听 127.0.0.1，供本机调试；目录列表仅 GET；请勿把端口暴露到公网。
    </NText>

    <!-- 加载态 -->
    <div v-if="busy" class="flex items-center gap-2">
      <NSpin size="small" />
      <NText depth="2" class="text-sm">正在{{ status.running ? '停止' : '启动' }}服务…</NText>
    </div>

    <!-- 运行态 -->
    <div v-else-if="status.running" class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <NText depth="2" class="text-sm">访问地址</NText>
        <NText class="font-mono text-sm">{{ address }}</NText>
        <NButton size="tiny" quaternary @click="copyAddress">
          <Copy class="mr-1 h-3 w-3" />{{ copied ? '已复制' : '复制' }}
        </NButton>
        <NText depth="3" class="text-xs">根目录：{{ status.root ?? root }}</NText>
      </div>

      <div class="flex flex-col gap-1">
        <NText depth="2" class="text-sm">最近访问（{{ status.requests.length }}）</NText>
        <div
          v-if="status.requests.length === 0"
          class="rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border, #e0e0e6)] px-3 py-2"
        >
          <NText depth="3" class="text-xs">还没有请求，浏览器打开上面的地址试试</NText>
        </div>
        <div v-else class="max-h-64 overflow-auto">
          <table class="w-full border-collapse text-left text-xs">
            <thead class="text-[var(--lumin-color-text-secondary)]">
              <tr>
                <th class="px-2 py-1 font-medium">时间</th>
                <th class="px-2 py-1 font-medium">方法</th>
                <th class="px-2 py-1 font-medium">路径</th>
                <th class="px-2 py-1 text-right font-medium">状态</th>
                <th class="px-2 py-1 text-right font-medium">字节</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(item, index) in status.requests"
                :key="`${item.time}-${index}`"
                class="border-t border-[var(--lumin-color-border, #e0e0e6)]"
              >
                <td class="px-2 py-1 font-mono">{{ new Date(item.time).toLocaleTimeString() }}</td>
                <td class="px-2 py-1">{{ item.method }}</td>
                <td class="max-w-64 truncate px-2 py-1 font-mono">{{ item.path }}</td>
                <td class="px-2 py-1 text-right">{{ item.status }}</td>
                <td class="px-2 py-1 text-right">{{ item.bytes }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 空态 -->
    <div
      v-else
      class="rounded-[var(--lumin-radius-md)] border border-dashed border-[var(--lumin-color-border, #e0e0e6)] px-4 py-6"
    >
      <NText depth="2" class="text-sm">
        选择根目录并点击「启动」即可在本机预览静态页面；服务运行期间切换页签不会中断。
      </NText>
    </div>
  </div>
</template>
