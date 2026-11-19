<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import MediaConvertView from '@lumin/tool-media-convert/renderer/ToolView.vue'

defineOptions({ name: 'MediaConvertToolPage' })
</script>

<template>
  <MediaConvertView />
</template>
