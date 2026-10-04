<template>
  <div class="fileguard-view">
    <PageHeader title="文件监管" subtitle="实时文件监控与审计">
      <template #actions>
        <NButton @click="refreshPage">
          <template #icon>
            <NIcon><RefreshIcon /></NIcon>
          </template>
          刷新
        </NButton>
      </template>
    </PageHeader>

    <div class="content">
      <FileGuardEmbed />
    </div>
  </div>
</template>

<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'
import FileGuardEmbed from '@/components/FileGuardEmbed.vue'
import { NButton, NIcon } from 'naive-ui'
import { Refresh } from '@vicons/tabler'

const RefreshIcon = Refresh

const refreshPage = () => {
  window.location.reload()
}
</script>

<style scoped>
.fileguard-view {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.content {
  flex: 1;
  overflow: hidden;
}
</style>
