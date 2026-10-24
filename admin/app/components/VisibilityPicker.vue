<script setup lang="ts">
import type { Visibility } from '#shared/types/site'

defineProps<{ modelValue: Visibility }>()
const emit = defineEmits<{ 'update:modelValue': [value: Visibility] }>()

const options: { value: Visibility; label: string; hint: string }[] = [
  { value: 'public', label: 'Public', hint: 'Visible par tout le monde sur le hub' },
  { value: 'private', label: 'Privé', hint: 'Visible sur le hub une fois connecté' },
  { value: 'hidden', label: 'Masqué', hint: "N'apparaît pas sur le hub" },
]
</script>

<template>
  <fieldset class="vis">
    <legend>Sur le hub</legend>
    <div class="seg" role="radiogroup">
      <label v-for="o in options" :key="o.value" :class="{ active: modelValue === o.value }" :title="o.hint">
        <input type="radio" name="visibility" :value="o.value" :checked="modelValue === o.value" @change="emit('update:modelValue', o.value)">
        {{ o.label }}
      </label>
    </div>
    <span class="hint">{{ options.find((o) => o.value === modelValue)?.hint }}</span>
  </fieldset>
</template>

<style scoped>
.vis { border: 0; display: flex; flex-direction: column; gap: 0.35rem; }
legend { font-size: 0.85rem; color: var(--text); font-weight: 500; margin-bottom: 0.35rem; }
.seg { display: flex; gap: 0.25rem; padding: 0.25rem; background: #111; border: 1px solid var(--border-strong); border-radius: 8px; }
.seg label {
  position: relative; flex: 1; text-align: center; cursor: pointer;
  padding: 0.4rem 0.5rem; border-radius: 6px; color: var(--muted); font-size: 0.85rem; font-weight: 500;
}
.seg label.active { background: #262626; color: var(--text-strong); }
.seg input { position: absolute; opacity: 0; pointer-events: none; }
.seg label:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 1px; }
.hint { font-size: 0.8rem; color: var(--muted); }
</style>
