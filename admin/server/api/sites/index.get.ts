export default defineEventHandler(async () => {
  const sites = await loadSites()
  return sites.map((site) => ({ ...site, host: hostOf(site) }))
})
