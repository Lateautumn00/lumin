<!-- 薄页面：只 import 工具包 ToolView（AGENTS §2 壳零工具知识） -->
<script setup lang="ts">
import QrCodeView from '@lumin/tool-qr-code/renderer/ToolView.vue'

defineOptions({ name: 'QrCodeToolPage' })
</script>

<template>
  <QrCodeView />
</template>
