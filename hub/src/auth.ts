import { PORTIER_VERIFY_URL } from './config.js'

/**
 * Demande au portier si la personne est connectée, en lui transmettant ses cookies :
 * c'est exactement l'appel que fait Traefik pour les sites protégés.
 * Le hub n'a donc aucun secret : la session reste vérifiée par le portier seul.
 * En cas de doute (portier injoignable, réponse inattendue) : pas connecté.
 */
export async function isLoggedIn(cookieHeader: string | undefined): Promise<boolean> {
  if (!cookieHeader || !/(?:^|;\s*)session=/.test(cookieHeader)) return false
  try {
    const res = await fetch(PORTIER_VERIFY_URL, {
      headers: { cookie: cookieHeader },
      redirect: 'manual',
      signal: AbortSignal.timeout(1500),
    })
    await res.body?.cancel()
    return res.status === 200
  } catch {
    return false
  }
}
