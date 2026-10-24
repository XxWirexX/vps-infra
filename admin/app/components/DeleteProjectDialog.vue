<script setup lang="ts">
import type { ServerProject } from '#shared/types/site'

const props = defineProps<{ project: ServerProject; hosts: string[] }>()
const emit = defineEmits<{ deleted: []; close: [] }>()

const confirmText = ref('')
const volumes = ref(false)
const submitting = ref(false)
const error = ref('')

interface DeleteJob {
  id: string
  status: 'running' | 'done' | 'failed'
  log: string[]
  result: { repo: string | null; warnings: string[] } | null
  error: string | null
}
const job = ref<DeleteJob | null>(null)
const logBox = ref<HTMLElement>()
let poll: ReturnType<typeof setInterval> | undefined

async function refreshJob(id: string) {
  try {
    job.value = await $fetch<DeleteJob>(`/api/jobs/${id}`)
    await nextTick()
    logBox.value?.scrollTo({ top: logBox.value.scrollHeight })
    if (job.value.status !== 'running') {
      clearInterval(poll)
      emit('deleted')
    }
  } catch {
    /* on réessaie au prochain tour */
  }
}

async function submit() {
  submitting.value = true
  error.value = ''
  try {
    const res = await $fetch<{ job: string }>(`/api/projects/${props.project.id}/delete`, {
      method: 'POST',
      body: { confirm: confirmText.value, volumes: volumes.value },
    })
    emit('deleted') // les routes sont déjà retirées
    job.value = { id: res.job, status: 'running', log: [], result: null, error: null }
    poll = setInterval(() => refreshJob(res.job), 1000)
    refreshJob(res.job)
  } catch (err) {
    error.value = await apiErrorMessage(err)
  } finally {
    submitting.value = false
  }
}
onBeforeUnmount(() => clearInterval(poll))

const dialog = ref<HTMLDialogElement>()
onMounted(() => dialog.value?.showModal())
function close() {
  if (job.value?.status === 'running' && !confirm('La suppression continue sur le serveur. Fermer quand même ?')) return
  dialog.value?.close()
}
</script>

<template>
  <dialog ref="dialog" class="dialog" @close="emit('close')" @cancel.prevent="close" @click.self="close">
    <form v-if="!job" class="body" @submit.prevent="submit">
      <h2>Supprimer « {{ project.id }} » ?</h2>

      <ul class="what">
        <li>
          Arrêt et suppression de ses conteneurs
          <template v-if="project.containers.length">
            (<code v-for="c in project.containers" :key="c.name">{{ c.name }}</code>)
          </template>
          et de ses images
        </li>
        <li v-if="hosts.length">
          Retrait de la route : <code v-for="h in hosts" :key="h">{{ h }}</code>
        </li>
        <li>Suppression du dossier <code>~/projects/{{ project.id }}</code> et de ses clés SSH</li>
        <li v-if="project.repo">
          Sur GitHub, retrait de la clé de déploiement et des secrets de <code>{{ project.repo }}</code>.
          <strong>Le repo est conservé</strong> (à supprimer à la main si besoin).
        </li>
      </ul>

      <label class="danger">
        <input v-model="volumes" type="checkbox">
        <span>
          <strong>Supprimer aussi les données</strong>
          <small>Volumes Docker : bases de données, fichiers envoyés… Irréversible. Décoché, ils sont gardés.</small>
        </span>
      </label>

      <label>
        <span>Pour confirmer, tape <code>{{ project.id }}</code></span>
        <input v-model="confirmText" type="text" autocomplete="off" spellcheck="false" :placeholder="project.id" autofocus>
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="actions">
        <button type="button" class="btn" @click="close">Annuler</button>
        <button type="submit" class="btn btn-danger-solid" :disabled="submitting || confirmText !== project.id">
          {{ submitting ? 'Suppression…' : 'Supprimer le projet' }}
        </button>
      </div>
    </form>

    <div v-else class="body">
      <h2>
        <span class="status" :class="job.result?.warnings?.length ? 'warn' : job.status" />
        {{ job.status === 'running' ? 'Suppression en cours…' : job.status === 'done' ? 'Projet supprimé' : 'La suppression a échoué' }}
      </h2>
      <pre ref="logBox" class="log">{{ job.log.join('\n') || '…' }}</pre>
      <p v-for="w in job.result?.warnings ?? []" :key="w" class="warning">{{ w }}</p>
      <p v-if="job.result?.repo" class="hint">
        Le repo est conservé : <a :href="job.result.repo" target="_blank" rel="noopener">{{ job.result.repo }}</a>
        (Settings → Delete this repository pour le supprimer).
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
  width: min(560px, calc(100% - 2rem));
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--card);
  color: var(--text);
}
.dialog::backdrop { background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(2px); }
.body { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; }
h2 { font-size: 1.1rem; color: var(--text-strong); display: flex; align-items: center; gap: 0.6rem; }
.what { display: flex; flex-direction: column; gap: 0.4rem; padding-left: 1.1rem; font-size: 0.88rem; color: #bbb; }
code { background: #111; border: 1px solid var(--border); border-radius: 4px; padding: 0.02rem 0.3rem; font-family: var(--mono); font-size: 0.8em; }
code + code { margin-left: 0.3rem; }
label { display: flex; flex-direction: column; gap: 0.35rem; }
label > span:first-child { font-size: 0.85rem; font-weight: 500; }
.danger {
  flex-direction: row; align-items: flex-start; gap: 0.65rem; cursor: pointer;
  padding: 0.7rem 0.85rem; border: 1px solid var(--border-strong); border-radius: 8px; background: #141414;
}
.danger:has(input:checked) { border-color: #7a2a2a; background: var(--danger-bg); }
.danger input { margin-top: 0.2rem; width: 1rem; height: 1rem; accent-color: var(--danger); flex-shrink: 0; }
.danger span { display: flex; flex-direction: column; gap: 0.15rem; }
.danger strong { font-size: 0.88rem; color: var(--danger); }
.danger small { font-size: 0.78rem; color: var(--muted); }
.error, .warning { border-radius: 8px; padding: 0.6rem 0.8rem; font-size: 0.85rem; }
.error { background: var(--danger-bg); border: 1px solid #5c2020; color: var(--danger); }
.warning { background: rgba(245, 176, 65, 0.1); border: 1px solid rgba(245, 176, 65, 0.3); color: var(--warn); }
.hint { font-size: 0.82rem; color: var(--muted); }
.hint a { color: var(--accent); }
.log {
  height: 260px; overflow: auto; margin: 0; padding: 0.75rem; border-radius: 8px;
  background: #0b0b0b; border: 1px solid var(--border);
  font-family: var(--mono); font-size: 0.75rem; line-height: 1.55; color: #bbb;
  white-space: pre-wrap; word-break: break-word;
}
.status { width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--warn); }
.status.running { animation: pulse 1s ease-in-out infinite; }
.status.done { background: var(--ok); }
.status.failed { background: var(--danger); }
@keyframes pulse { 50% { opacity: 0.3; } }
.btn-danger-solid { background: #b33a3a; border-color: #b33a3a; color: #fff; }
.btn-danger-solid:hover:not(:disabled) { background: #9c2f2f; }
.actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
</style>
