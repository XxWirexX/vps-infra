<script setup lang="ts">
import type { Site, SiteHealth } from '#shared/types/site'

type SiteRow = Site & { host: string }

const domain = useRuntimeConfig().public.domain as string

const { data: sites, refresh: refreshSites } = await useFetch<SiteRow[]>('/api/sites', { default: () => [] })
const { data: global, refresh: refreshGlobal } = await useFetch<{ maintenance: boolean }>('/api/global', {
  default: () => ({ maintenance: false }),
})

// ── État des conteneurs (rafraîchi toutes les 30 s, côté navigateur uniquement) ──
const health = ref<Record<string, SiteHealth>>({})
async function refreshHealth() {
  try {
    health.value = await $fetch<Record<string, SiteHealth>>('/api/sites/health')
  } catch {
    /* on garde le dernier état connu */
  }
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  refreshHealth()
  timer = setInterval(refreshHealth, 30_000)
})
onBeforeUnmount(() => clearInterval(timer))

// ── Notifications ──
const toast = ref<{ message: string; error?: boolean } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined
function notify(message: string, error = false) {
  toast.value = { message, error }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 3500)
}
function errorMessage(err: any) {
  return err?.data?.message || err?.message || 'Erreur inattendue.'
}

// ── Actions ──
const busy = ref<string | null>(null)

async function toggleSiteMaintenance(site: SiteRow, enabled: boolean) {
  busy.value = site.id
  try {
    await $fetch(`/api/sites/${site.id}/maintenance`, { method: 'POST', body: { enabled } })
    await refreshSites()
    notify(enabled ? `${site.host} est en maintenance.` : `${site.host} est de nouveau en ligne.`)
  } catch (err) {
    notify(errorMessage(err), true)
  } finally {
    busy.value = null
  }
}

async function toggleGlobal(enabled: boolean) {
  busy.value = '__global'
  try {
    await $fetch('/api/global/maintenance', { method: 'POST', body: { enabled } })
    await refreshGlobal()
    notify(enabled ? 'Filet de sécurité en maintenance (503).' : 'Filet de sécurité en 404.')
  } catch (err) {
    notify(errorMessage(err), true)
  } finally {
    busy.value = null
  }
}

async function removeSite(site: SiteRow) {
  if (!confirm(`Retirer la route de ${site.host} ?\n\nLe conteneur « ${site.container} » n'est pas arrêté, seul le sous-domaine est supprimé.`)) return
  busy.value = site.id
  try {
    await $fetch(`/api/sites/${site.id}`, { method: 'DELETE' })
    await refreshSites()
    notify(`Route de ${site.host} supprimée.`)
  } catch (err) {
    notify(errorMessage(err), true)
  } finally {
    busy.value = null
  }
}

// ── Formulaire ──
const editing = ref<SiteRow | null>(null)
const formOpen = ref(false)
function openForm(site: SiteRow | null = null) {
  editing.value = site
  formOpen.value = true
}
async function onSaved() {
  const wasEdit = !!editing.value
  formOpen.value = false
  await refreshSites()
  refreshHealth()
  notify(wasEdit ? 'Site mis à jour.' : 'Site ajouté.')
}

// ── Nouveau projet ──
const projectOpen = ref(false)
async function onProjectCreated() {
  await refreshSites()
  refreshHealth()
}
async function onProjectClosed() {
  projectOpen.value = false
  await refreshSites()
  refreshHealth()
}

function healthOf(site: SiteRow) {
  return health.value[site.id]
}
</script>

<template>
  <div class="page">
    <header class="top">
      <div>
        <h1>Admin</h1>
        <p class="sub mono">{{ domain }}</p>
      </div>
      <a class="btn btn-ghost" :href="`https://hub.${domain}`" target="_blank" rel="noopener">Voir le hub ↗</a>
    </header>

    <!-- Filet de sécurité -->
    <section class="global" :class="{ active: global.maintenance }">
      <div>
        <h2>Filet de sécurité</h2>
        <p>
          Domaines sans site associé :
          <strong>{{ global.maintenance ? 'page de maintenance (503)' : 'page 404' }}</strong>
        </p>
      </div>
      <ToggleSwitch
        :model-value="global.maintenance"
        :disabled="busy === '__global'"
        label="Mettre le filet de sécurité en maintenance"
        @update:model-value="toggleGlobal"
      />
    </section>

    <!-- Sites -->
    <section>
      <div class="section-head">
        <h2>Sites <span class="count">{{ sites.length }}</span></h2>
        <div class="head-actions">
          <button class="btn" @click="openForm()">+ Site existant</button>
          <button class="btn btn-primary" @click="projectOpen = true">+ Nouveau projet</button>
        </div>
      </div>

      <div v-if="!sites.length" class="empty">
        <p>Aucun site géré par le panel pour l'instant.</p>
        <p class="hint">Crée un nouveau projet, ou ajoute un conteneur existant pour lui attribuer un sous-domaine.</p>
      </div>

      <ul v-else class="sites">
        <li v-for="site in sites" :key="site.id" class="site" :class="{ maintenance: site.maintenance }">
          <span
            class="dot"
            :class="healthOf(site) ? (healthOf(site)!.up ? 'up' : 'down') : 'unknown'"
            :title="healthOf(site)
              ? (healthOf(site)!.up ? `Conteneur en ligne (HTTP ${healthOf(site)!.status}, ${healthOf(site)!.ms} ms)` : 'Conteneur injoignable')
              : 'Vérification…'"
          />

          <div class="info">
            <div class="name">
              {{ site.name }}
              <span v-if="site.maintenance" class="badge">maintenance</span>
              <span v-if="(site.visibility ?? 'private') === 'public'" class="badge vis-public" title="Visible par tout le monde sur le hub">public</span>
              <span v-else-if="site.visibility === 'hidden'" class="badge vis-hidden" title="N'apparaît pas sur le hub">masqué</span>
            </div>
            <a :href="`https://${site.host}`" target="_blank" rel="noopener" class="host mono">{{ site.host }}</a>
            <div class="target mono">→ {{ site.container }}:{{ site.port }}</div>
          </div>

          <label class="maint">
            <span>Maintenance</span>
            <ToggleSwitch
              :model-value="site.maintenance"
              :disabled="busy === site.id"
              :label="`Mettre ${site.host} en maintenance`"
              @update:model-value="(v) => toggleSiteMaintenance(site, v)"
            />
          </label>

          <div class="actions">
            <button class="btn btn-ghost" :disabled="busy === site.id" @click="openForm(site)">Modifier</button>
            <button class="btn btn-ghost btn-danger" :disabled="busy === site.id" @click="removeSite(site)">Supprimer</button>
          </div>
        </li>
      </ul>
    </section>

    <SiteForm v-if="formOpen" :site="editing" @saved="onSaved" @close="formOpen = false" />
    <ProjectForm v-if="projectOpen" @created="onProjectCreated" @close="onProjectClosed" />

    <Transition name="toast">
      <div v-if="toast" class="toast" :class="{ error: toast.error }" role="status">{{ toast.message }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.page {
  max-width: 880px;
  margin: 0 auto;
  padding: 2.5rem 1rem 4rem;
  display: flex; flex-direction: column; gap: 1.75rem;
}
.top { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
h1 { font-size: 1.6rem; color: var(--text-strong); letter-spacing: -0.02em; }
h2 { font-size: 1rem; color: var(--text-strong); font-weight: 600; }
.sub { color: var(--muted); }

.global {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 1rem 1.25rem;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.global p { color: var(--muted); font-size: 0.9rem; }
.global strong { color: var(--text); font-weight: 500; }
.global.active { border-color: rgba(245, 176, 65, 0.5); }
.global.active strong { color: var(--warn); }

.section-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
.head-actions { display: flex; gap: 0.5rem; }
.count {
  margin-left: 0.35rem; padding: 0.05rem 0.5rem; border-radius: 999px;
  background: #222; color: var(--muted); font-size: 0.8rem; font-weight: 500;
}

.empty {
  padding: 2.5rem 1rem; text-align: center;
  border: 1px dashed var(--border-strong); border-radius: var(--radius);
}
.hint { color: var(--muted); font-size: 0.85rem; margin-top: 0.35rem; }

.sites { list-style: none; display: flex; flex-direction: column; gap: 0.6rem; }
.site {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center; gap: 1rem;
  padding: 0.9rem 1.1rem;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  transition: border-color 0.15s;
}
.site.maintenance { border-color: rgba(245, 176, 65, 0.45); }

.dot { width: 0.6rem; height: 0.6rem; border-radius: 50%; background: var(--muted); }
.dot.up { background: var(--ok); box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.15); }
.dot.down { background: var(--danger); box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.15); }

.info { min-width: 0; }
.name { color: var(--text-strong); font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
.badge {
  font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
  padding: 0.05rem 0.45rem; border-radius: 4px;
  background: rgba(245, 176, 65, 0.15); color: var(--warn);
}
.badge.vis-public { background: rgba(74, 222, 128, 0.12); color: var(--ok); }
.badge.vis-hidden { background: #222; color: var(--muted); }
.host { color: var(--accent); text-decoration: none; display: block; overflow: hidden; text-overflow: ellipsis; }
.host:hover { text-decoration: underline; }
.target { color: var(--muted); }

.maint { display: flex; align-items: center; gap: 0.6rem; color: var(--muted); font-size: 0.85rem; }
.actions { display: flex; gap: 0.25rem; }

@media (max-width: 640px) {
  .site { grid-template-columns: auto 1fr; }
  .maint, .actions { grid-column: 2; }
}

.toast {
  position: fixed; left: 50%; bottom: 1.5rem; transform: translateX(-50%);
  max-width: calc(100% - 2rem);
  padding: 0.7rem 1.1rem; border-radius: 8px;
  background: #222; border: 1px solid var(--border-strong); color: var(--text);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  font-size: 0.9rem;
}
.toast.error { background: var(--danger-bg); border-color: #5c2020; color: var(--danger); }
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, 0.5rem); }
</style>
