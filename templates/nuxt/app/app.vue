<script setup lang="ts">
const { data } = await useFetch('/api/hello')
</script>

<template>
  <main>
    <h1>__PROJECT_NAME__</h1>
    <p>{{ data?.message }}</p>
    <p class="hint">Modifie <code>app/app.vue</code>, pousse sur <code>main</code>, et l'app se redéploie toute seule.</p>
  </main>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; }
body {
  min-height: 100dvh; display: grid; place-items: center; padding: 1.5rem;
  background: #0f0f0f; color: #e0e0e0; font-family: system-ui, sans-serif; text-align: center;
}
h1 { color: #fff; font-size: 2rem; margin-bottom: 0.75rem; }
p { color: #999; margin-top: 0.5rem; }
code { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 4px; padding: 0.1rem 0.35rem; }
.hint { font-size: 0.9rem; color: #666; }
</style>
