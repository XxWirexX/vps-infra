export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const enabled = await readEnabled(event)
  const site = await updateSites((sites) => {
    const site = findSiteOr404(sites, id)
    site.maintenance = enabled
    site.updatedAt = new Date().toISOString()
    return site
  })
  return { ...site, host: hostOf(site) }
})
