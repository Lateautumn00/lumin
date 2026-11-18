<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import VideoDownloadView from '@lumin/tool-video-download/renderer/ToolView.vue'

defineOptions({ name: 'VideoDownloadToolPage' })
</script>

<template>
  <VideoDownloadView />
</template>
