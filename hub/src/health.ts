import type { HubSite } from './sites.js'

interface Health { up: boolean; at: number }
const cache = new Map<string, Health>()
const TTL = 30_000

/**
 * Vérifie que le conteneur d'un site répond, par le réseau Docker.
 * Résultat gardé 30 s, pour ne pas solliciter les sites à chaque visite du hub.
 */
async function check(site: HubSite): Promise<boolean> {
  try {
    const res = await fetch(`http://${site.container}:${site.port}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(2000),
    })
    await res.body?.cancel()
    return true
  } catch {
    return false
  }
}

export async function healthOf(sites: HubSite[]): Promise<Map<string, boolean>> {
  const now = Date.now()
  const results = await Promise.all(
    sites.map(async (site) => {
      const key = `${site.container}:${site.port}`
      const cached = cache.get(key)
      if (cached && now - cached.at < TTL) return [site.id, cached.up] as const
      const up = await check(site)
      cache.set(key, { up, at: Date.now() })
      return [site.id, up] as const
    }),
  )
  return new Map(results)
}
