export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  await updateSites((sites) => {
    const index = sites.findIndex((s) => s.id === id)
    if (index === -1) throw createError({ statusCode: 404, message: 'Site introuvable.' })
    sites.splice(index, 1)
  })
  setResponseStatus(event, 204)
  return null
})
