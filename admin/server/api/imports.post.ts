/**
 * Importe un repo GitHub existant : l'agent le clone, détecte son type, ajoute ce qui
 * manque pour le déploiement (Dockerfile, compose, workflow), branche les clés et la CD.
 * La route du sous-domaine est créée à la fin, quand le port de l'application est connu.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const web = body.web !== false
  const sites = await loadSites()

  const repo = typeof body.repo === 'string' ? body.repo.trim() : ''
  if (!/^(?:[A-Za-z0-9-]{1,39}\/)?[A-Za-z0-9._-]{1,100}$/.test(repo)) {
    throw createError({ statusCode: 400, message: 'Repo invalide : nom-du-repo ou proprietaire/nom-du-repo.' })
  }
  const port = body.port === '' || body.port == null ? null : body.port

  let id: string, name: string, subdomain = ''
  if (web) {
    // Validation complète maintenant (sous-domaine libre…), pour échouer avant de toucher à GitHub
    const input = parseSiteInput(
      { id: body.id, name: body.name, subdomain: body.subdomain, container: body.id, port: port ?? 80 },
      sites,
    )
    ;({ name, subdomain } = input)
    id = input.id!
  } else {
    ;({ id, name } = parseProjectIdentity(body, sites))
  }

  const { job } = await callAgent<{ job: string }>('POST', '/imports', {
    repo, id, name, web, subdomain, port,
  })
  if (web) addPendingRoute(job, { id, name, subdomain })
  setResponseStatus(event, 202)
  return { job }
})
