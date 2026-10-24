import type { Site } from '#shared/types/site'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const site = await updateSites((sites) => {
    const input = parseSiteInput(body, sites)
    const now = new Date().toISOString()
    const created: Site = {
      id: input.id!,
      name: input.name,
      subdomain: input.subdomain,
      container: input.container,
      port: input.port,
      maintenance: false,
      visibility: input.visibility,
      description: input.description,
      createdAt: now,
      updatedAt: now,
    }
    sites.push(created)
    return created
  })
  setResponseStatus(event, 201)
  return { ...site, host: hostOf(site) }
})
