<!-- fs-cleaner 主视图（M41）：四页签共享目录记忆与配置 -->
<script setup lang="ts">
// 作者：cuilanchao · 修改时间：2026-11-21
// 三态强制：各页签内含空态引导 / 进度可取消 / 结构化错误可重试；删除一律走系统回收站
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { NTabPane, NTabs } from 'naive-ui'
import { DEFAULT_TEMP_EXTENSIONS, DEFAULT_TREE_DEPTH } from '../schema'
import { parseExtensions, parsePatterns } from '../tree'
import { config, setConfig } from './client'
import TreePanel from './TreePanel.vue'
import EmptyDirsPanel from './EmptyDirsPanel.vue'
import TouchPanel from './TouchPanel.vue'
import TempCleanPanel from './TempCleanPanel.vue'

const root = ref('')
const treeDepth = ref<number>(DEFAULT_TREE_DEPTH)
const excludeText = ref('')
const tempExtensionsText = ref(DEFAULT_TEMP_EXTENSIONS.join(', '))
const loaded = ref(false)

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** 保存记忆（跨页签共享 lastRoot 与各自选项；失败不影响使用） */
async function persist(): Promise<void> {
  try {
    await setConfig({
      lastRoot: root.value,
      treeDepth: treeDepth.value,
      treeExclude: parsePatterns(excludeText.value)
        .filter((item) => item.length <= 100)
        .slice(0, 50),
      tempExtensions: parseExtensions(tempExtensionsText.value)
        .filter((item) => item.length <= 32)
        .slice(0, 50)
    })
  } catch {
    // 记忆失败不打断当前操作
  }
}

onMounted(() => {
  void config()
    .then((saved) => {
      if (saved.lastRoot !== null) root.value = saved.lastRoot
      treeDepth.value = saved.treeDepth
      excludeText.value = saved.treeExclude.join('\n')
      tempExtensionsText.value = saved.tempExtensions.join(', ')
    })
    .catch(() => undefined)
    .finally(() => {
      loaded.value = true
    })
})

watch([root, treeDepth, excludeText, tempExtensionsText], () => {
  if (!loaded.value) return
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    void persist()
  }, 400)
})

onUnmounted(() => {
  if (persistTimer !== null) clearTimeout(persistTimer)
})
</script>

<template>
  <div class="flex max-w-4xl flex-col gap-4">
    <div>
      <h1 class="text-base font-semibold">文件清理</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        导出目录树、清理空文件夹与临时文件、批量修改文件时间；所有删除操作均移入系统回收站，可随时还原。
      </p>
    </div>

    <NTabs type="line" default-value="tree">
      <NTabPane name="tree" tab="目录树导出">
        <div class="pt-3">
          <TreePanel
            v-model:root="root"
            v-model:depth="treeDepth"
            v-model:exclude-text="excludeText"
          />
        </div>
      </NTabPane>
      <NTabPane name="empty-dirs" tab="空文件夹清理">
        <div class="pt-3">
          <EmptyDirsPanel v-model:root="root" />
        </div>
      </NTabPane>
      <NTabPane name="touch" tab="批量改时间">
        <div class="pt-3">
          <TouchPanel v-model:root="root" />
        </div>
      </NTabPane>
      <NTabPane name="temp-clean" tab="临时文件清理">
        <div class="pt-3">
          <TempCleanPanel v-model:root="root" v-model:extensions-text="tempExtensionsText" />
        </div>
      </NTabPane>
    </NTabs>
  </div>
</template>
