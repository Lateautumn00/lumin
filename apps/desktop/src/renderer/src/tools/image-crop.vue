<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import ImageCropView from '@lumin/tool-image-crop/renderer/ToolView.vue'

defineOptions({ name: 'ImageCropToolPage' })
</script>

<template>
  <ImageCropView />
</template>
