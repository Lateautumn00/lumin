<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import PdfImagesView from '@lumin/tool-pdf-images/renderer/ToolView.vue'

defineOptions({ name: 'PdfImagesToolPage' })
</script>

<template>
  <PdfImagesView />
</template>
