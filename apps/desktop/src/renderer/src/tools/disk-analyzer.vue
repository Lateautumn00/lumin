<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import DiskAnalyzerView from '@lumin/tool-disk-analyzer/renderer/ToolView.vue'

defineOptions({ name: 'DiskAnalyzerToolPage' })
</script>

<template>
  <DiskAnalyzerView />
</template>
