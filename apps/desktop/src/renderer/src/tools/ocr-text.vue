<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import OcrTextView from '@lumin/tool-ocr-text/renderer/ToolView.vue'

defineOptions({ name: 'OcrTextToolPage' })
</script>

<template>
  <OcrTextView />
</template>
