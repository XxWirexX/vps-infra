import type { ProjectTemplate, Site } from '#shared/types/site'

/**
 * Crée un projet : l'agent s'occupe du repo, des clés et du déploiement,
 * le panel ajoute la route du sous-domaine vers le futur conteneur.
 * La route est créée tout de suite : tant que le conteneur n'a pas démarré,
 * le point d'état reste rouge.
 */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event)) ?? {}
  const templates = await callAgent<ProjectTemplate[]>('GET', '/templates')
  const template = templates.find((t) => t.id === body.template)
  if (!template) throw createError({ statusCode: 400, message: 'Modèle inconnu.' })

  // Programme sans web : rien à router, on transmet juste la demande à l'agent.
  if (!template.web) {
    const { id, name } = parseProjectIdentity(body, await loadSites())
    const { job } = await callAgent<{ job: string }>('POST', '/projects', { id, name, template: template.id })
    setResponseStatus(event, 202)
    return { job, site: null }
  }

  return updateSites(async (sites) => {
    // Même validation qu'un site : identifiant libre, sous-domaine valide et non pris.
    // Le conteneur porte le nom du projet, le port vient du modèle (ou du formulaire pour « Autre stack »).
    const port = template.customPort ? body.port : template.port
    const input = parseSiteInput(
      { id: body.id, name: body.name, subdomain: body.subdomain, container: body.id, port },
      sites,
    )

    const { job } = await callAgent<{ job: string }>('POST', '/projects', {
      id: input.id,
      name: input.name,
      template: template.id,
      subdomain: input.subdomain,
      port: input.port,
    })

    const now = new Date().toISOString()
    const site: Site = {
      id: input.id!,
      name: input.name,
      subdomain: input.subdomain,
      container: input.container,
      port: input.port,
      maintenance: false,
      createdAt: now,
      updatedAt: now,
    }
    sites.push(site)
    setResponseStatus(event, 202)
    return { job, site: { ...site, host: hostOf(site) } }
  })
})
