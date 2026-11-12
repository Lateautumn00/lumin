<script setup lang="ts">
import AppSidebar from './AppSidebar.vue'
import StatusBar from './StatusBar.vue'
</script>

<template>
  <div class="flex h-full flex-col bg-[var(--lumin-color-bg)] text-[var(--lumin-color-text)]">
    <div class="flex min-h-0 flex-1">
      <aside class="w-56 shrink-0 border-r border-[var(--lumin-color-border)]">
        <AppSidebar />
      </aside>
      <main class="min-w-0 flex-1 overflow-auto p-6">
        <router-view />
      </main>
    </div>
    <StatusBar />
  </div>
</template>
