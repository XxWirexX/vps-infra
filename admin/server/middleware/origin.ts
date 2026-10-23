/**
 * Protection CSRF pour les actions (POST/PUT/DELETE).
 *
 * Le cookie du portier est valable sur tout *.wireredblue.xyz, avec SameSite=Lax :
 * un autre de tes sous-domaines (un projet compromis, par exemple) pourrait donc
 * déclencher une action ici avec ta session. On refuse toute requête qui ne vient
 * pas de la page du panel elle-même, en vérifiant l'en-tête Origin, que le
 * navigateur remplit et qu'une page ne peut pas falsifier.
 */
export default defineEventHandler((event) => {
  if (!event.path.startsWith('/api/')) return
  const method = event.method
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return

  const allowed = useRuntimeConfig().allowedOrigin as string
  const origin = getRequestHeader(event, 'origin')
  if (origin !== allowed) {
    throw createError({ statusCode: 403, message: 'Origine refusée.' })
  }
})
