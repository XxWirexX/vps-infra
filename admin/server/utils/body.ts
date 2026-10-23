/** Lit un booléen { enabled: true|false } dans le corps de la requête. */
export async function readEnabled(event: Parameters<typeof readBody>[0]): Promise<boolean> {
  const body = await readBody<{ enabled?: unknown }>(event)
  if (typeof body?.enabled !== 'boolean') {
    throw createError({ statusCode: 400, message: 'Champ « enabled » attendu (true ou false).' })
  }
  return body.enabled
}
