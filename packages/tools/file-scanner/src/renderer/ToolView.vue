<script setup lang="ts">
/**
 * @file ToolView.vue 文件扫描工具箱主视图（校验 / 重复文件 / 目录对比 / 批量重命名 / 文件清理 / 磁盘分析 / 压缩包 七页签）
 * @author cuilanchao
 * @date 2026-11-25
 * @description 合并原 file-hasher / duplicate-finder / folder-compare（M71）、
 *              file-renamer / fs-cleaner / disk-analyzer（M75）与 zip-tool（M81）为单入口；
 *              页签使用 display-directive="show" 保留各页签状态（切换不中断在跑任务）
 */
import { ref } from 'vue'
import { NTabPane, NTabs } from 'naive-ui'
import CompareTab from './tabs/CompareTab.vue'
import DuplicateTab from './tabs/DuplicateTab.vue'
import HashTab from './tabs/HashTab.vue'
import RenameTab from '../rename/renderer/ToolView.vue'
import CleanTab from '../clean/renderer/ToolView.vue'
import DiskTab from '../disk/renderer/ToolView.vue'
import ZipTab from './tabs/ZipTab.vue'

/** 页签键 */
type TabKey = 'hash' | 'duplicate' | 'compare' | 'rename' | 'clean' | 'disk' | 'zip'

const active = ref<TabKey>('hash')
</script>

<template>
  <div class="flex flex-col gap-3">
    <div>
      <h1 class="text-base font-semibold">文件扫描</h1>
      <p class="mt-1 text-sm text-[var(--lumin-color-text-secondary)]">
        校验文件哈希、查找重复文件、对比目录差异、批量重命名、清理空目录/临时文件、分析磁盘占用、ZIP
        打包与解压；全部离线本地执行，删除仅移入回收站。
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
      <NTabPane name="rename" tab="批量重命名">
        <div class="pt-2">
          <RenameTab />
        </div>
      </NTabPane>
      <NTabPane name="clean" tab="文件清理">
        <div class="pt-2">
          <CleanTab />
        </div>
      </NTabPane>
      <NTabPane name="disk" tab="磁盘分析">
        <div class="pt-2">
          <DiskTab />
        </div>
      </NTabPane>
      <NTabPane name="zip" tab="压缩包">
        <div class="pt-2">
          <ZipTab />
        </div>
      </NTabPane>
    </NTabs>
  </div>
</template>
