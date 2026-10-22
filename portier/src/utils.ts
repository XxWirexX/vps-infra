const DEFAULT_REDIRECT = 'https://wireredblue.xyz'

/** Échappe les 5 caractères HTML dangereux. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/**
 * Accepte uniquement wireredblue.xyz et ses sous-domaines en HTTPS.
 * Le "." dans endsWith('.wireredblue.xyz') empêche evilwireredblue.xyz de passer.
 */
export function isSafeRedirect(rd: string): boolean {
  try {
    const { hostname, protocol } = new URL(rd)
    if (protocol !== 'https:') return false
    return hostname === 'wireredblue.xyz' || hostname.endsWith('.wireredblue.xyz')
  } catch {
    return false
  }
}

export function safeRd(rd: string | null | undefined): string {
  if (rd && isSafeRedirect(rd)) return rd
  return DEFAULT_REDIRECT
}
