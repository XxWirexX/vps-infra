import { readFile } from 'node:fs/promises'
import { DOMAIN, SITES_FILE } from './config.js'

export type Visibility = 'public' | 'private' | 'hidden'

export interface HubSite {
  id: string
  name: string
  description: string
  host: string
  container: string
  port: number
  maintenance: boolean
  visibility: Visibility
  /** Connexion au portier obligatoire pour y accéder */
  protected: boolean
}

/**
 * Lit sites.json, la source de vérité du panel admin. Le fichier est relu à chaque
 * requête (il est minuscule) : un site ajouté dans le panel apparaît tout de suite.
 * Un site sans visibilité (créé avant cette option) est traité comme privé.
 */
export async function loadSites(): Promise<HubSite[]> {
  let raw: { sites?: any[] }
  try {
    raw = JSON.parse(await readFile(SITES_FILE, 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[hub] sites.json illisible :', err)
    return []
  }
  return (raw.sites ?? [])
    .filter((s) => s && typeof s.id === 'string')
    .map((s) => ({
      id: s.id,
      name: String(s.name ?? s.id),
      description: typeof s.description === 'string' ? s.description : '',
      host: s.subdomain ? `${s.subdomain}.${DOMAIN}` : DOMAIN,
      container: String(s.container ?? ''),
      port: Number(s.port) || 80,
      maintenance: !!s.maintenance,
      protected: !!s.protected,
      visibility: (['public', 'private', 'hidden'] as const).includes(s.visibility) ? s.visibility : 'private',
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}
