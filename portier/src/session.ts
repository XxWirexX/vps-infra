import type { Context } from 'hono'
import { getSignedCookie, setSignedCookie } from 'hono/cookie'

export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000
export const COOKIE_NAME = 'session'

export async function getSession(c: Context): Promise<boolean> {
  const secret = process.env.SESSION_SECRET
  if (!secret) return false
  const raw = await getSignedCookie(c, secret, COOKIE_NAME)
  if (!raw) return false
  try {
    const { exp } = JSON.parse(raw) as { exp: number }
    return Date.now() < exp
  } catch {
    return false
  }
}

/** Pose le cookie de session signé sur la réponse. */
export async function createSession(c: Context): Promise<void> {
  const secret = process.env.SESSION_SECRET!
  const domain = process.env.COOKIE_DOMAIN || undefined
  const payload = JSON.stringify({ exp: Date.now() + SESSION_DURATION_MS })

  await setSignedCookie(c, COOKIE_NAME, payload, secret, {
    httpOnly: true,
    secure:   true,
    sameSite: 'Lax',
    maxAge:   SESSION_DURATION_MS / 1000,
    path:     '/',
    ...(domain ? { domain } : {}),
  })
}
