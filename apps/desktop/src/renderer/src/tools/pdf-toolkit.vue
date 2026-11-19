<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import PdfToolkitView from '@lumin/tool-pdf-toolkit/renderer/ToolView.vue'

defineOptions({ name: 'PdfToolkitToolPage' })
</script>

<template>
  <PdfToolkitView />
</template>
