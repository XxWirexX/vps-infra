/**
 * Session du portier : quand elle expire (ou que les cookies sont effacés), Traefik redirige
 * chaque appel d'API vers auth.wireredblue.xyz. Le navigateur bloque cette redirection
 * au milieu d'un fetch, qui échoue alors sans réponse (« NetworkError »).
 * On le détecte ici pour afficher un vrai message au lieu de l'erreur réseau.
 */
export const useSessionExpired = () => useState('session-expired', () => false)

/** true si la session du portier n'est plus valide (l'API répond par une redirection). */
export async function sessionLost(): Promise<boolean> {
  try {
    const res = await fetch('/api/global', { redirect: 'manual', cache: 'no-store' })
    return res.type === 'opaqueredirect' || res.status === 401 || res.status === 302
  } catch {
    return false
  }
}

/**
 * Transforme une erreur d'appel d'API en message lisible.
 * Si la requête n'a reçu aucune réponse, on vérifie si c'est la session qui a expiré.
 */
export async function apiErrorMessage(err: any, fallback = 'Erreur inattendue.'): Promise<string> {
  const message = err?.data?.message
  if (message) return message
  if (err?.response === undefined || err?.statusCode === undefined) {
    if (await sessionLost()) {
      useSessionExpired().value = true
      return 'Ta session a expiré : recharge la page pour te reconnecter.'
    }
    return 'Le serveur ne répond pas. Vérifie ta connexion et réessaie.'
  }
  return err?.message || fallback
}
