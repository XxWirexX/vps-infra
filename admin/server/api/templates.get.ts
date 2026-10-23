import type { ProjectTemplate } from '#shared/types/site'

export default defineEventHandler(async () => {
  const [templates, health] = await Promise.all([
    callAgent<ProjectTemplate[]>('GET', '/templates'),
    callAgent<{ ok: boolean; dryRun: boolean }>('GET', '/health'),
  ])
  return { templates, dryRun: health.dryRun }
})
