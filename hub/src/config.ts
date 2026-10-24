export const DOMAIN = process.env.DOMAIN || 'wireredblue.xyz'
/** État du panel admin, monté en lecture seule */
export const SITES_FILE = process.env.SITES_FILE || '/data/sites.json'
/** Endpoint ForwardAuth du portier, joint par le réseau Docker */
export const PORTIER_VERIFY_URL = process.env.PORTIER_VERIFY_URL || 'http://portier:3000/verify'
export const PORT = Number(process.env.PORT || 3000)

/** Outils fixes, affichés seulement une fois connecté (ils ne sont pas dans le panel) */
export const TOOLS = [
  { name: 'Admin', description: 'Sites, maintenance, nouveaux projets', host: `admin.${DOMAIN}` },
  { name: 'Portier', description: 'Connexion, passkeys', host: `auth.${DOMAIN}` },
]
