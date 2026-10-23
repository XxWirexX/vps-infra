export default defineEventHandler(async () => ({
  maintenance: await isGlobalMaintenance(),
}))
