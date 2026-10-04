<template>
  <div class="fileguard-container">
    <div class="toolbar">
      <NButton @click="reloadService" :loading="loading">
        <template #icon>
          <NIcon><RefreshIcon /></NIcon>
        </template>
        刷新
      </NButton>
      <NButton @click="startService" v-if="!serviceStatus.running" type="primary">
        启动服务
      </NButton>
      <NButton @click="stopService" v-else type="error">
        停止服务
      </NButton>
      <NSpace>
        <NTag :type="serviceStatus.running ? 'success' : 'error'">
          {{ serviceStatus.running ? '运行中' : '已停止' }}
        </NTag>
        <NTag type="info">{{ serviceStatus.port || '—' }}</NTag>
      </NSpace>
    </div>

    <div class="webview-wrapper" v-if="serviceStatus.running">
      <iframe
        :src="serviceUrl"
        class="webview-iframe"
        frameborder="0"
        @load="onIframeLoad"
      />
    </div>

    <NEmpty v-else description="服务未启动">
      <template #extra>
        <NButton type="primary" @click="startService">启动 FileGuard 服务</NButton>
      </template>
    </NEmpty>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { NButton, NIcon, NTag, NSpace, NEmpty } from 'naive-ui'
import { Refresh } from '@vicons/tabler'
import { invoke } from '@tauri-apps/api/core'

const RefreshIcon = Refresh

const loading = ref(false)
const serviceStatus = ref({
  running: false,
  port: 8686,
  pid: null as number | null
})

const serviceUrl = computed(() => {
  return serviceStatus.value.running
    ? `http://127.0.0.1:${serviceStatus.value.port}`
    : ''
})

const startService = async () => {
  loading.value = true
  try {
    await invoke('start_fileguard_service')
    await checkStatus()
  } catch (e) {
    console.error('启动失败', e)
  } finally {
    loading.value = false
  }
}

const stopService = async () => {
  loading.value = true
  try {
    await invoke('stop_fileguard_service')
    serviceStatus.value.running = false
  } catch (e) {
    console.error('停止失败', e)
  } finally {
    loading.value = false
  }
}

const reloadService = async () => {
  loading.value = true
  await new Promise(resolve => setTimeout(resolve, 500))
  loading.value = false
}

const checkStatus = async () => {
  try {
    const status = await invoke<{ running: boolean; port: number; pid: number | null }>('get_fileguard_status')
    serviceStatus.value = status
  } catch (e) {
    console.error('获取状态失败', e)
  }
}

const onIframeLoad = () => {
  console.log('FileGuard iframe loaded')
}

onMounted(() => {
  checkStatus()
  // 每 5 秒检查一次状态
  setInterval(checkStatus, 5000)
})
</script>

<style scoped>
.fileguard-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-card);
}

.webview-wrapper {
  flex: 1;
  overflow: hidden;
}

.webview-iframe {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
