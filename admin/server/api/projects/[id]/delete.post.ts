import type { ServerProject } from '#shared/types/site'

/**
 * Supprime un projet du serveur : l'agent arrête ses conteneurs, retire ses clés et son dossier,
 * et nettoie la clé de déploiement et les secrets côté GitHub (le repo est conservé).
 * Le panel retire tout de suite les routes qui pointaient vers ses conteneurs.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(id)) {
    throw createError({ statusCode: 400, message: 'Identifiant invalide.' })
  }
  const body = (await readBody(event)) ?? {}
  if (body.confirm !== id) {
    throw createError({ statusCode: 400, message: "Retape l'identifiant du projet pour confirmer." })
  }

  const project = (await callAgent<ServerProject[]>('GET', '/projects')).find((p) => p.id === id)
  if (!project) throw createError({ statusCode: 404, message: 'Projet introuvable sur le serveur.' })

  const { job } = await callAgent<{ job: string }>('POST', `/projects/${id}/delete`, {
    confirm: id,
    volumes: body.volumes === true,
  })

  // Routes vers ce projet : même identifiant, ou conteneur appartenant au projet
  const containers = new Set([id, ...project.containers.map((c) => c.name)])
  const removed = await updateSites((sites) => {
    const gone = sites.filter((s) => s.id === id || containers.has(s.container)).map((s) => s.id)
    for (const siteId of gone) sites.splice(sites.findIndex((s) => s.id === siteId), 1)
    return gone
  })

  setResponseStatus(event, 202)
  return { job, removedSites: removed }
})
