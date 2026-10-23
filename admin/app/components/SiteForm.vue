<script setup lang="ts">
import type { Site } from '#shared/types/site'

const props = defineProps<{ site?: Site | null }>()
const emit = defineEmits<{ saved: []; close: [] }>()

const domain = useRuntimeConfig().public.domain as string
const isEdit = computed(() => !!props.site)

const form = reactive({
  id: props.site?.id ?? '',
  name: props.site?.name ?? '',
  subdomain: props.site?.subdomain ?? '',
  container: props.site?.container ?? '',
  port: props.site?.port ?? 3000,
})

// À la création, l'identifiant suit le nom tant qu'on ne l'a pas modifié soi-même.
const idTouched = ref(false)
watch(() => form.name, (name) => {
  if (isEdit.value || idTouched.value) return
  form.id = name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
})

const preview = computed(() => (form.subdomain ? `${form.subdomain}.${domain}` : domain))

const saving = ref(false)
const error = ref('')

async function submit() {
  saving.value = true
  error.value = ''
  try {
    const body = { ...form, port: Number(form.port) }
    if (isEdit.value) {
      await $fetch(`/api/sites/${props.site!.id}`, { method: 'PUT', body })
    } else {
      await $fetch('/api/sites', { method: 'POST', body })
    }
    emit('saved')
  } catch (err: any) {
    error.value = err?.data?.message || err?.message || 'Erreur inattendue.'
  } finally {
    saving.value = false
  }
}

const dialog = ref<HTMLDialogElement>()
onMounted(() => dialog.value?.showModal())
</script>

<template>
  <dialog ref="dialog" class="dialog" @close="emit('close')" @click.self="dialog?.close()">
    <form class="body" @submit.prevent="submit">
      <h2>{{ isEdit ? `Modifier « ${site!.name} »` : 'Ajouter un site existant' }}</h2>

      <label>
        <span>Nom</span>
        <input v-model="form.name" type="text" required maxlength="60" placeholder="DLE Community" autofocus>
      </label>

      <label v-if="!isEdit">
        <span>Identifiant <small>— fichier site-{{ form.id || '…' }}.yml, non modifiable ensuite</small></span>
        <input v-model="form.id" type="text" required maxlength="32" pattern="[a-z0-9-]+" @input="idTouched = true">
      </label>

      <label>
        <span>Sous-domaine <small>— vide pour la racine</small></span>
        <div class="suffix">
          <input v-model="form.subdomain" type="text" maxlength="63" placeholder="dle">
          <span class="mono">.{{ domain }}</span>
        </div>
        <span class="hint">→ <a :href="`https://${preview}`" target="_blank" rel="noopener" class="mono">https://{{ preview }}</a></span>
      </label>

      <div class="row">
        <label class="grow">
          <span>Conteneur</span>
          <input v-model="form.container" type="text" required placeholder="dle_web">
        </label>
        <label class="port">
          <span>Port</span>
          <input v-model="form.port" type="number" required min="1" max="65535">
        </label>
      </div>
      <p class="hint">Le conteneur doit être branché sur le réseau Docker <code>proxy</code>.</p>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="actions">
        <button type="button" class="btn" @click="dialog?.close()">Annuler</button>
        <button type="submit" class="btn btn-primary" :disabled="saving">
          {{ saving ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Ajouter' }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.dialog {
  margin: auto;
  width: min(480px, calc(100% - 2rem));
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--card);
  color: var(--text);
}
.dialog::backdrop { background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(2px); }
.body { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; }
h2 { font-size: 1.1rem; color: var(--text-strong); }
label { display: flex; flex-direction: column; gap: 0.35rem; }
label > span:first-child { font-size: 0.85rem; color: var(--text); font-weight: 500; }
small { color: var(--muted); font-weight: 400; }
.suffix { display: flex; align-items: center; gap: 0.5rem; }
.suffix span { color: var(--muted); white-space: nowrap; }
.row { display: flex; gap: 0.75rem; }
.grow { flex: 1; }
.port { width: 6.5rem; }
.hint { font-size: 0.8rem; color: var(--muted); }
.hint a { color: var(--accent); text-decoration: none; }
.error {
  background: var(--danger-bg); border: 1px solid #5c2020; color: var(--danger);
  border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.85rem;
}
.actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.25rem; }
</style>
