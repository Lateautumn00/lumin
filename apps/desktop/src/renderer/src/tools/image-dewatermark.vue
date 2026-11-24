<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import ImageDewatermarkView from '@lumin/tool-image-dewatermark/renderer/ToolView.vue'

defineOptions({ name: 'ImageDewatermarkToolPage' })
</script>

<template>
  <ImageDewatermarkView />
</template>
