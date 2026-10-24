/** Un site géré par le panel : un sous-domaine qui pointe vers un conteneur. */
export interface Site {
  /** Identifiant stable, sert aussi de nom de fichier (site-<id>.yml) */
  id: string
  /** Nom affiché */
  name: string
  /** Sous-domaine, ou '' pour la racine du domaine */
  subdomain: string
  /** Nom du conteneur Docker (sur le réseau proxy) */
  container: string
  /** Port écouté par le conteneur */
  port: number
  /** true = le site renvoie la page de maintenance (503) */
  maintenance: boolean
  createdAt: string
  updatedAt: string
}

/** Champs modifiables depuis le formulaire */
export type SiteInput = Pick<Site, 'name' | 'subdomain' | 'container' | 'port'> & { id?: string }

export interface SiteHealth {
  up: boolean
  status?: number
  ms?: number
}

/** Modèle de projet proposé par l'agent */
export interface ProjectTemplate {
  id: string
  label: string
  description: string
  port: number
  /** false : programme sans web (pas de sous-domaine ni de route) */
  web: boolean
}

/** Avancement d'une création de projet */
export interface ProjectJob {
  id: string
  project: string
  status: 'running' | 'done' | 'failed'
  log: string[]
  result: { repo: string; clone: string; host: string | null } | null
  error: string | null
}
