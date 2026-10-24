import type { ProjectJob, Site } from '#shared/types/site'

/**
 * Routes en attente d'un import : le port de l'application n'est connu qu'une fois
 * que l'agent a détecté le type de projet. On garde la demande ici, et on crée la route
 * dès que la tâche est terminée, soit par une surveillance en arrière-plan, soit au
 * prochain affichage de la tâche dans le panel (les deux sont sans effet en double).
 */
interface Pending {
  id: string
  name: string
  subdomain: string
  error?: string
  created?: boolean
}

const pending = new Map<string, Pending>()

export function addPendingRoute(jobId: string, route: Omit<Pending, 'error' | 'created'>) {
  pending.set(jobId, route)
  watch(jobId)
}

/** Crée la route si la tâche est terminée. Renvoie la tâche, complétée de l'état de la route. */
export async function settleRoute(job: ProjectJob): Promise<ProjectJob> {
  const p = pending.get(job.id)
  if (!p) return job
  if (job.status === 'done' && job.result?.route && !p.created && !p.error) {
    const route = job.result.route
    try {
      await updateSites((sites) => {
        if (sites.some((s) => s.id === p.id)) return
        const input = parseSiteInput(
          { id: p.id, name: p.name, subdomain: p.subdomain, container: route.container, port: route.port },
          sites,
        )
        const now = new Date().toISOString()
        const site: Site = {
          id: input.id!,
          name: input.name,
          subdomain: input.subdomain,
          container: input.container,
          port: input.port,
          maintenance: false,
          createdAt: now,
          updatedAt: now,
        }
        sites.push(site)
      })
      p.created = true
    } catch (err: any) {
      p.error = err?.message || 'Impossible de créer la route.'
    }
  }
  return { ...job, routeCreated: !!p.created, routeError: p.error }
}

/** Surveille la tâche en arrière-plan (au plus 30 minutes), même si le panel est fermé. */
function watch(jobId: string) {
  const started = Date.now()
  const tick = async () => {
    try {
      const job = await settleRoute(await callAgent<ProjectJob>('GET', `/jobs/${jobId}`))
      if (job.status !== 'running') return
    } catch {
      /* agent momentanément injoignable : on réessaie */
    }
    if (Date.now() - started < 30 * 60_000) setTimeout(tick, 3000)
  }
  setTimeout(tick, 3000)
}
