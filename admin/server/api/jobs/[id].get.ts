import type { ProjectJob } from '#shared/types/site'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[a-f0-9]{12}$/.test(id)) throw createError({ statusCode: 404, message: 'Tâche introuvable.' })
  return callAgent<ProjectJob>('GET', `/jobs/${id}`)
})
