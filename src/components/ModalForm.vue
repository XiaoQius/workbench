<script setup lang="ts">
import { reactive, watch } from 'vue'
import { NModal, NCard, NForm, NFormItem, NInput, NInputNumber, NSelect, NButton, NSpace } from 'naive-ui'

export interface FieldDef {
  key: string
  label: string
  type?: 'text' | 'textarea' | 'number' | 'select' | 'date'
  options?: Array<{ label: string; value: string | number }>
  placeholder?: string
  span?: number
  required?: boolean
}

const props = withDefaults(
  defineProps<{
    show: boolean
    title: string
    fields?: FieldDef[]
    initial?: Record<string, unknown>
    confirmText?: string
  }>(),
  { fields: () => [], initial: () => ({}), confirmText: '保存' },
)

const emit = defineEmits<{ (e: 'update:show', v: boolean): void; (e: 'submit', values: Record<string, unknown>): void }>()

const form = reactive<Record<string, unknown>>({})
const errors = reactive<Record<string, string>>({})

function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  if (typeof v === 'number') return Number.isNaN(v)
  return false
}

watch(
  () => props.show,
  (v) => {
    if (v) {
      for (const k of Object.keys(errors)) delete errors[k]
      for (const f of props.fields) {
        form[f.key] = props.initial[f.key] ?? (f.type === 'number' ? null : '')
      }
    }
  },
)

// 支持外部（如「从本机程序识别」）更新表单初值：initial 变化时覆盖对应字段
watch(
  () => props.initial,
  (v) => {
    if (!props.show) return
    for (const f of props.fields) {
      if (v[f.key] !== undefined) {
        form[f.key] = v[f.key]
      }
    }
  },
  { deep: true },
)

function submit() {
  for (const k of Object.keys(errors)) delete errors[k]
  for (const f of props.fields) {
    if (f.required && isBlank(form[f.key])) {
      errors[f.key] = `${f.label}不能为空`
    }
  }
  if (Object.keys(errors).length) return
  emit('submit', { ...form })
  emit('update:show', false)
}
</script>

<template>
  <n-modal :show="show" @update:show="(v: boolean) => emit('update:show', v)" preset="card" :title="title" style="width: 520px; max-width: calc(100vw - 48px)">
    <slot v-if="!fields.length" />
    <n-form v-else label-placement="top" :show-feedback="false">
      <div class="form-grid">
        <n-form-item v-for="f in fields" :key="f.key" :label="f.label" :style="{ gridColumn: `span ${f.span ?? 2}` }">
          <template #label>
            <span>{{ f.label }}</span>
            <span v-if="f.required" class="req-star">*</span>
          </template>
          <n-input v-if="!f.type || f.type === 'text'" v-model:value="(form[f.key] as string)" :placeholder="f.placeholder" :status="errors[f.key] ? 'error' : undefined" @update:value="() => delete errors[f.key]" />
          <n-input v-else-if="f.type === 'textarea'" v-model:value="(form[f.key] as string)" type="textarea" :rows="3" :placeholder="f.placeholder" :status="errors[f.key] ? 'error' : undefined" @update:value="() => delete errors[f.key]" />
          <n-input-number v-else-if="f.type === 'number'" v-model:value="(form[f.key] as number | null)" class="w-full" :placeholder="f.placeholder" :status="errors[f.key] ? 'error' : undefined" @update:value="() => delete errors[f.key]" />
          <n-select v-else-if="f.type === 'select'" v-model:value="(form[f.key] as string | number)" :options="f.options" :placeholder="f.placeholder" :status="errors[f.key] ? 'error' : undefined" @update:value="() => delete errors[f.key]" />
          <input v-else-if="f.type === 'date'" v-model="(form[f.key] as string)" type="date" class="wb-date-input" :placeholder="f.placeholder" @input="() => delete errors[f.key]" />
          <div v-if="errors[f.key]" class="field-err">{{ errors[f.key] }}</div>
        </n-form-item>
      </div>
      <!-- 扩展插槽：表单下方追加内容（如「从本机程序识别」快速选择） -->
      <slot name="extra" />
    </n-form>
    <template #footer>
      <n-space justify="end">
        <n-button quaternary @click="emit('update:show', false)">取消</n-button>
        <n-button type="primary" @click="submit()">{{ confirmText }}</n-button>
      </n-space>
    </template>
  </n-modal>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0 12px;
}
.w-full {
  width: 100%;
}
.wb-date-input {
  width: 100%;
  box-sizing: border-box;
  padding: 5px 10px;
  font-size: 13px;
  border: 1px solid var(--wb-border);
  border-radius: var(--wb-radius-sm);
  background: var(--wb-card-alt);
  color: var(--wb-text-1);
  outline: none;
}
.wb-date-input:focus {
  border-color: var(--wb-accent);
}
.req-star {
  color: var(--wb-danger, #e11d48);
  margin-left: 2px;
}
.field-err {
  margin-top: 4px;
  font-size: 12px;
  color: var(--wb-danger, #e11d48);
}
</style>
