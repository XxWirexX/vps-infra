import type { ServerProject } from '#shared/types/site'

/** Projets présents sur le serveur, avec l'état de leurs conteneurs (via l'agent). */
export default defineEventHandler(() => callAgent<ServerProject[]>('GET', '/projects'))
