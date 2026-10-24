<script setup lang="ts">
defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <label class="prot">
    <input type="checkbox" :checked="modelValue" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)">
    <span>
      <strong>Protégé par le portier</strong>
      <small>Connexion obligatoire pour accéder au site, comme pour l'admin. À cocher pour tout ce qui ne doit pas être ouvert à tous.</small>
    </span>
  </label>
</template>

<style scoped>
.prot {
  display: flex; align-items: flex-start; gap: 0.65rem; cursor: pointer;
  padding: 0.7rem 0.85rem; border: 1px solid var(--border-strong); border-radius: 8px; background: #141414;
}
.prot:has(input:checked) { border-color: var(--accent); background: rgba(79, 142, 247, 0.06); }
.prot input { margin-top: 0.2rem; width: 1rem; height: 1rem; accent-color: var(--accent); flex-shrink: 0; }
.prot span { display: flex; flex-direction: column; gap: 0.15rem; }
.prot strong { font-size: 0.88rem; color: var(--text-strong); font-weight: 600; }
.prot small { font-size: 0.78rem; color: var(--muted); }
</style>
