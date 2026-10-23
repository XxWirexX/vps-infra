export default defineEventHandler(async (event) => {
  const enabled = await readEnabled(event)
  await setGlobalMaintenance(enabled)
  return { maintenance: enabled }
})
