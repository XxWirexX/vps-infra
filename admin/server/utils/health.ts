import type { Site, SiteHealth } from '#shared/types/site'

/**
 * Vérifie qu'un conteneur répond, directement sur le réseau Docker.
 * N'importe quelle réponse HTTP (même 404 ou une redirection) compte comme "en ligne" :
 * on teste que le service tourne, pas que la page d'accueil est correcte.
 */
export async function checkHealth(site: Site): Promise<SiteHealth> {
  const start = Date.now()
  try {
    const res = await fetch(`http://${site.container}:${site.port}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    })
    await res.body?.cancel()
    return { up: true, status: res.status, ms: Date.now() - start }
  } catch {
    return { up: false }
  }
}
