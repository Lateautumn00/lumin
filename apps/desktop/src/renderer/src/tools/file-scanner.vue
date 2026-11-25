<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import FileScannerView from '@lumin/tool-file-scanner/renderer/ToolView.vue'

defineOptions({ name: 'FileScannerToolPage' })
</script>

<template>
  <FileScannerView />
</template>
