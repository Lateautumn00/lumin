<script setup lang="ts">
/**
 * @file ToolView.vue 文件扫描工具箱主视图（文件校验 / 重复文件 / 目录对比 三页签）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 合并原 file-hasher / duplicate-finder / folder-compare 三工具为单入口；
 *              页签使用 display-directive="show" 保留各页签状态（切换不中断在跑任务）
 */
import { ref } from 'vue'
import { NTabPane, NTabs } from 'naive-ui'
import CompareTab from './tabs/CompareTab.vue'
import DuplicateTab from './tabs/DuplicateTab.vue'
import HashTab from './tabs/HashTab.vue'

/** 页签键 */
type TabKey = 'hash' | 'duplicate' | 'compare'

const active = ref<TabKey>('hash')
</script>

<template>
  <div class="flex flex-col gap-3">
    <div>
      <h1 class="text-base font-semibold">文件扫描</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        校验文件哈希、查找重复文件、对比两个目录的差异；全部离线本地执行，对比只读分析，清理仅移入回收站。
      </p>
    </div>

    <NTabs v-model:value="active" type="line" animated display-directive="show">
      <NTabPane name="hash" tab="文件校验">
        <div class="pt-2">
          <HashTab />
        </div>
      </NTabPane>
      <NTabPane name="duplicate" tab="重复文件">
        <div class="pt-2">
          <DuplicateTab />
        </div>
      </NTabPane>
      <NTabPane name="compare" tab="目录对比">
        <div class="pt-2">
          <CompareTab />
        </div>
      </NTabPane>
    </NTabs>
  </div>
</template>
