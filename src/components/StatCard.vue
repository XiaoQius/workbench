<script setup lang="ts">
import { computed } from 'vue'
import { useThemeStore } from '@/stores/theme'

const props = defineProps<{
  label: string
  value: string | number
  sub?: string
  color?: string
  icon?: string
  clickable?: boolean
}>()

const emit = defineEmits<{ (e: 'click'): void }>()

const themeStore = useThemeStore()
const accent = computed(() => props.color ?? 'var(--wb-accent)')
</script>

<template>
  <div class="stat-card wb-card" :class="{ clickable }" @click="clickable && emit('click')">
    <div class="stat-icon" :style="{ color: accent, background: `color-mix(in srgb, ${accent} 10%, transparent)` }">
      {{ icon ?? '▧' }}
    </div>
    <div class="stat-body">
      <div class="stat-label">{{ label }}</div>
      <div class="stat-value mono" :style="{ color: accent }">{{ value }}</div>
      <div v-if="sub" class="stat-sub">{{ sub }}</div>
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  align-items: center;
}
.stat-card.clickable {
  cursor: pointer;
}
.stat-card.clickable:hover {
  transform: translateY(-2px);
  box-shadow: var(--wb-shadow-hover);
  border-color: var(--wb-card-hover-border);
}
.stat-icon {
  width: 38px;
  height: 38px;
  border-radius: var(--wb-radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  flex: none;
}
.stat-body {
  min-width: 0;
}
.stat-label {
  font-size: 12px;
  color: var(--wb-text-2);
}
.stat-value {
  font-size: 21px;
  font-weight: 650;
  line-height: 1.25;
}
.stat-sub {
  font-size: 11.5px;
  color: var(--wb-text-3);
}
</style>
