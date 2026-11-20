<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import BatchOcrView from '@lumin/tool-batch-ocr/renderer/ToolView.vue'

defineOptions({ name: 'BatchOcrToolPage' })
</script>

<template>
  <BatchOcrView />
</template>
