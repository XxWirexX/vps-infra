import type { SiteHealth } from '#shared/types/site'

export default defineEventHandler(async () => {
  const sites = await loadSites()
  const results = await Promise.all(sites.map(async (s) => [s.id, await checkHealth(s)] as const))
  return Object.fromEntries(results) as Record<string, SiteHealth>
})
