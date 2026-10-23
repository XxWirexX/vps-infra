<script setup lang="ts">
defineProps<{ modelValue: boolean; disabled?: boolean; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    class="switch"
    :class="{ on: modelValue }"
    :aria-checked="modelValue"
    :aria-label="label"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="thumb" />
  </button>
</template>

<style scoped>
.switch {
  position: relative;
  flex-shrink: 0;
  width: 2.5rem; height: 1.4rem;
  border-radius: 999px;
  border: 1px solid var(--border-strong);
  background: #222;
  transition: background 0.15s, border-color 0.15s;
}
.switch.on { background: var(--warn); border-color: var(--warn); }
.thumb {
  position: absolute; top: 2px; left: 2px;
  width: calc(1.4rem - 6px); height: calc(1.4rem - 6px);
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s;
}
.switch.on .thumb { transform: translateX(1.1rem); }
</style>
