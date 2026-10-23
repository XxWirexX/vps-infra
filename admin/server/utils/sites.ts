import { readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { stringify } from 'yaml'
import type { Site, SiteInput } from '#shared/types/site'

// ── Config ────────────────────────────────────────────────────────────────────

function cfg() {
  const c = useRuntimeConfig()
  return {
    domain: c.domain as string,
    dynamicDir: c.dynamicDir as string,
    stateFile: c.stateFile as string,
  }
}

/** Sous-domaines que le panel ne doit jamais attribuer (gérés ailleurs, en labels). */
const RESERVED_SUBDOMAINS = new Set(['admin', 'auth', 'www'])

/** Préfixe des fichiers Traefik générés par le panel. */
const FILE_PREFIX = 'site-'

/**
 * Priorité des routes du panel : plus haute que celle des labels Docker
 * (qui vaut la longueur de la règle, ~30). Un site peut donc être repris
 * par le panel avant même d'avoir retiré ses labels.
 */
const ROUTER_PRIORITY = 100

// ── Validation ────────────────────────────────────────────────────────────────

const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/

export function hostOf(site: Pick<Site, 'subdomain'>): string {
  const { domain } = cfg()
  return site.subdomain ? `${site.subdomain}.${domain}` : domain
}

/**
 * Valide et normalise ce qui arrive du formulaire.
 * Tout ce qui finit dans un fichier Traefik passe par ici : les regex garantissent
 * qu'aucun caractère spécial (backtick, guillemet, retour à la ligne…) ne peut
 * modifier la règle Host() générée.
 */
export function parseSiteInput(body: unknown, sites: Site[], currentId?: string): SiteInput {
  const b = (body ?? {}) as Record<string, unknown>
  const fail = (message: string) => {
    throw createError({ statusCode: 400, message: message })
  }

  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name || name.length > 60) fail('Le nom doit faire entre 1 et 60 caractères.')

  const subdomain = typeof b.subdomain === 'string' ? b.subdomain.trim().toLowerCase() : ''
  if (subdomain && !SUBDOMAIN_RE.test(subdomain)) {
    fail('Sous-domaine invalide : lettres minuscules, chiffres et tirets uniquement.')
  }
  if (RESERVED_SUBDOMAINS.has(subdomain)) fail(`Le sous-domaine « ${subdomain} » est réservé.`)
  if (sites.some((s) => s.id !== currentId && s.subdomain === subdomain)) {
    fail(`${hostOf({ subdomain })} est déjà utilisé par un autre site.`)
  }

  const container = typeof b.container === 'string' ? b.container.trim() : ''
  if (!CONTAINER_RE.test(container)) fail('Nom de conteneur invalide.')

  const port = Number(b.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('Le port doit être un entier entre 1 et 65535.')

  const input: SiteInput = { name, subdomain, container, port }

  // L'id n'est choisi qu'à la création, il ne change plus ensuite.
  if (!currentId) {
    const id = typeof b.id === 'string' ? b.id.trim().toLowerCase() : ''
    if (!ID_RE.test(id)) fail('Identifiant invalide : 1 à 32 caractères, minuscules, chiffres et tirets.')
    if (sites.some((s) => s.id === id)) fail(`L'identifiant « ${id} » existe déjà.`)
    input.id = id
  }

  return input
}

// ── État (sites.json) ─────────────────────────────────────────────────────────

export async function loadSites(): Promise<Site[]> {
  try {
    const raw = await readFile(cfg().stateFile, 'utf8')
    const data = JSON.parse(raw) as { sites?: Site[] }
    return Array.isArray(data.sites) ? data.sites : []
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
}

async function saveSites(sites: Site[]) {
  const sorted = [...sites].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  await writeFileAtomic(cfg().stateFile, JSON.stringify({ sites: sorted }, null, 2) + '\n')
}

// ── Fichiers Traefik ──────────────────────────────────────────────────────────

/** Génère la config Traefik d'un site (un routeur + un service). */
export function renderSite(site: Site): string {
  const name = `${FILE_PREFIX}${site.id}`
  const config = {
    http: {
      routers: {
        [name]: {
          rule: `Host(\`${hostOf(site)}\`)`,
          entryPoints: ['websecure'],
          // En maintenance, on envoie vers le service 503 défini dans 00-maintenance.yml
          service: site.maintenance ? 'maintenance-503' : name,
          priority: ROUTER_PRIORITY,
        },
      },
      services: {
        [name]: {
          loadBalancer: {
            servers: [{ url: `http://${site.container}:${site.port}` }],
          },
        },
      },
    },
  }
  return `# Généré par le panel admin, ne pas modifier à la main.\n${stringify(config)}`
}

/**
 * Aligne le dossier de Traefik sur l'état : écrit un fichier par site,
 * supprime les fichiers site-*.yml qui ne correspondent plus à rien.
 * Les autres fichiers du dossier (00-maintenance.yml…) ne sont jamais touchés.
 */
async function syncTraefik(sites: Site[]) {
  const { dynamicDir } = cfg()
  const wanted = new Set<string>()
  for (const site of sites) {
    const file = `${FILE_PREFIX}${site.id}.yml`
    wanted.add(file)
    await writeFileAtomic(join(dynamicDir, file), renderSite(site))
  }
  const existing = await readdir(dynamicDir).catch(() => [] as string[])
  for (const file of existing) {
    if (file.startsWith(FILE_PREFIX) && file.endsWith('.yml') && !wanted.has(file)) {
      await unlink(join(dynamicDir, file))
    }
  }
}

/**
 * Applique une modification : lecture de l'état, modification, sauvegarde,
 * puis régénération des fichiers Traefik. Les appels sont sérialisés.
 */
export function updateSites<T>(fn: (sites: Site[]) => T | Promise<T>): Promise<T> {
  return serialized(async () => {
    const sites = await loadSites()
    const result = await fn(sites)
    await saveSites(sites)
    await syncTraefik(sites)
    return result
  })
}

export function findSiteOr404(sites: Site[], id: string): Site {
  const site = sites.find((s) => s.id === id)
  if (!site) throw createError({ statusCode: 404, message: 'Site introuvable.' })
  return site
}
