<script setup lang="ts">
import type { ProjectJob, ProjectTemplate } from '#shared/types/site'

const emit = defineEmits<{ created: []; close: [] }>()
const domain = useRuntimeConfig().public.domain as string

// ── Modèles ──
const templates = ref<ProjectTemplate[]>([])
const dryRun = ref(false)
const loadError = ref('')
onMounted(async () => {
  dialog.value?.showModal()
  try {
    const res = await $fetch<{ templates: ProjectTemplate[]; dryRun: boolean }>('/api/templates')
    templates.value = res.templates
    dryRun.value = res.dryRun
    form.template ||= res.templates[0]?.id ?? ''
  } catch (err: any) {
    loadError.value = err?.data?.message || "Impossible de joindre l'agent."
  }
})

// ── Formulaire ──
const form = reactive({ name: '', id: '', template: '', subdomain: '' })
const idTouched = ref(false)
const subTouched = ref(false)
watch(() => form.name, (name) => {
  const slug = name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  if (!idTouched.value) form.id = slug
  if (!subTouched.value) form.subdomain = slug
})
const selected = computed(() => templates.value.find((t) => t.id === form.template))
const isWeb = computed(() => selected.value?.web !== false)
const preview = computed(() => (form.subdomain ? `${form.subdomain}.${domain}` : domain))

const submitting = ref(false)
const error = ref('')

// ── Suivi de la création ──
const job = ref<ProjectJob | null>(null)
const logBox = ref<HTMLElement>()
let poll: ReturnType<typeof setInterval> | undefined

async function refreshJob(id: string) {
  try {
    job.value = await $fetch<ProjectJob>(`/api/jobs/${id}`)
    await nextTick()
    logBox.value?.scrollTo({ top: logBox.value.scrollHeight })
    if (job.value.status !== 'running') clearInterval(poll)
  } catch {
    /* l'agent peut être occupé, on réessaie au prochain tour */
  }
}

async function submit() {
  submitting.value = true
  error.value = ''
  try {
    const res = await $fetch<{ job: string }>('/api/projects', { method: 'POST', body: { ...form } })
    emit('created') // la route existe déjà : on rafraîchit la liste derrière
    job.value = { id: res.job, project: form.id, status: 'running', log: [], result: null, error: null }
    poll = setInterval(() => refreshJob(res.job), 1000)
    refreshJob(res.job)
  } catch (err: any) {
    error.value = err?.data?.message || err?.message || 'Erreur inattendue.'
  } finally {
    submitting.value = false
  }
}
onBeforeUnmount(() => clearInterval(poll))

const copied = ref(false)
async function copyClone() {
  if (!job.value?.result) return
  await navigator.clipboard.writeText(job.value.result.clone)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

const dialog = ref<HTMLDialogElement>()
function close() {
  // Pendant la création, on évite de fermer par erreur : le travail continue
  // côté serveur, mais on perdrait le journal.
  if (job.value?.status === 'running' && !confirm('La création continue sur le serveur. Fermer quand même ?')) return
  dialog.value?.close()
}
</script>

<template>
  <dialog ref="dialog" class="dialog" @close="emit('close')" @cancel.prevent="close" @click.self="close">
    <!-- Étape 1 : formulaire -->
    <form v-if="!job" class="body" @submit.prevent="submit">
      <h2>Nouveau projet</h2>
      <p v-if="dryRun" class="dry">Agent en mode dry-run : rien ne sera créé sur GitHub ni lancé.</p>

      <p v-if="loadError" class="error" role="alert">{{ loadError }}</p>

      <template v-else>
        <label>
          <span>Nom</span>
          <input v-model="form.name" type="text" required maxlength="60" placeholder="Mon blog" autofocus>
        </label>

        <fieldset>
          <legend>Modèle</legend>
          <div class="templates">
            <label v-for="t in templates" :key="t.id" class="tpl" :class="{ selected: form.template === t.id }">
              <input v-model="form.template" type="radio" name="template" :value="t.id" required>
              <strong>{{ t.label }}</strong>
              <span>{{ t.description }}</span>
            </label>
          </div>
        </fieldset>

        <div class="row">
          <label class="grow">
            <span>Identifiant <small>— repo, dossier et conteneur</small></span>
            <input v-model="form.id" type="text" required maxlength="32" pattern="[a-z0-9-]+" @input="idTouched = true">
          </label>
        </div>

        <label v-if="isWeb">
          <span>Sous-domaine <small>— vide pour la racine</small></span>
          <div class="suffix">
            <input v-model="form.subdomain" type="text" maxlength="63" @input="subTouched = true">
            <span class="mono">.{{ domain }}</span>
          </div>
          <span class="hint mono">→ https://{{ preview }}</span>
        </label>
        <p v-else class="hint">
          Pas de sous-domaine : le programme n'est pas exposé sur le web. Il démarre avec un
          <code>docker-compose.yml</code> de démo, à remplacer par le tien (le README du repo explique comment).
        </p>

        <p class="hint">
          L'agent crée le repo privé <code>{{ form.id || '…' }}</code> sur GitHub, les clés de déploiement,
          lance le projet et branche la CD : chaque push sur <code>main</code> redéploiera.
        </p>
      </template>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="actions">
        <button type="button" class="btn" @click="close">Annuler</button>
        <button type="submit" class="btn btn-primary" :disabled="submitting || !!loadError || !templates.length">
          {{ submitting ? 'Lancement…' : 'Créer le projet' }}
        </button>
      </div>
    </form>

    <!-- Étape 2 : journal de création -->
    <div v-else class="body">
      <h2>
        <span class="status" :class="job.status" />
        {{ job.status === 'running' ? 'Création en cours…' : job.status === 'done' ? 'Projet prêt' : 'La création a échoué' }}
      </h2>

      <pre ref="logBox" class="log">{{ job.log.join('\n') || '…' }}</pre>

      <div v-if="job.result" class="success">
        <p v-if="job.result.host">En ligne sur <a :href="`https://${job.result.host}`" target="_blank" rel="noopener">https://{{ job.result.host }}</a></p>
        <p>Sur ton PC :</p>
        <div class="clone">
          <code>{{ job.result.clone }}</code>
          <button type="button" class="btn" @click="copyClone">{{ copied ? 'Copié ✓' : 'Copier' }}</button>
        </div>
        <p class="hint"><a :href="job.result.repo" target="_blank" rel="noopener">Voir le repo sur GitHub</a></p>
      </div>

      <p v-if="job.status === 'failed'" class="hint">
        La route du sous-domaine a été créée : supprime-la depuis la liste des sites si tu abandonnes ce projet.
      </p>

      <div class="actions">
        <button type="button" class="btn" :class="{ 'btn-primary': job.status !== 'running' }" @click="close">Fermer</button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.dialog {
  margin: auto;
  width: min(620px, calc(100% - 2rem));
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--card);
  color: var(--text);
}
.dialog::backdrop { background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(2px); }
.body { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; }
h2 { font-size: 1.1rem; color: var(--text-strong); display: flex; align-items: center; gap: 0.6rem; }
label { display: flex; flex-direction: column; gap: 0.35rem; }
label > span:first-child, legend { font-size: 0.85rem; color: var(--text); font-weight: 500; }
fieldset { border: 0; display: flex; flex-direction: column; gap: 0.35rem; }
small { color: var(--muted); font-weight: 400; }
.suffix { display: flex; align-items: center; gap: 0.5rem; }
.suffix span { color: var(--muted); white-space: nowrap; }
.row { display: flex; gap: 0.75rem; }
.grow { flex: 1; }
.hint { font-size: 0.8rem; color: var(--muted); }
.hint a, .success a { color: var(--accent); }
code { background: #111; border: 1px solid var(--border); border-radius: 4px; padding: 0.05rem 0.3rem; }

.templates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
.tpl {
  position: relative; gap: 0.15rem; padding: 0.7rem 0.85rem; cursor: pointer;
  border: 1px solid var(--border-strong); border-radius: 8px; background: #141414;
  transition: border-color 0.15s, background 0.15s;
}
.tpl input { position: absolute; opacity: 0; pointer-events: none; }
.tpl strong { color: var(--text-strong); font-size: 0.9rem; }
.tpl span { color: var(--muted); font-size: 0.78rem; line-height: 1.35; }
.tpl.selected { border-color: var(--accent); background: rgba(79, 142, 247, 0.08); }
.tpl:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 520px) { .templates { grid-template-columns: 1fr; } }

.dry {
  font-size: 0.8rem; color: var(--warn);
  background: rgba(245, 176, 65, 0.1); border: 1px solid rgba(245, 176, 65, 0.3);
  border-radius: 8px; padding: 0.5rem 0.75rem;
}
.error {
  background: var(--danger-bg); border: 1px solid #5c2020; color: var(--danger);
  border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.85rem;
}

.log {
  height: 280px; overflow: auto; margin: 0;
  padding: 0.75rem; border-radius: 8px;
  background: #0b0b0b; border: 1px solid var(--border);
  font-family: var(--mono); font-size: 0.75rem; line-height: 1.55; color: #bbb;
  white-space: pre-wrap; word-break: break-word;
}
.status { width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--warn); }
.status.running { animation: pulse 1s ease-in-out infinite; }
.status.done { background: var(--ok); }
.status.failed { background: var(--danger); }
@keyframes pulse { 50% { opacity: 0.3; } }

.success { display: flex; flex-direction: column; gap: 0.4rem; font-size: 0.9rem; }
.clone { display: flex; gap: 0.5rem; align-items: center; }
.clone code { flex: 1; padding: 0.5rem 0.6rem; overflow-x: auto; white-space: nowrap; font-family: var(--mono); font-size: 0.8rem; }

.actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.25rem; }
</style>
