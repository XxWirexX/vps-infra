import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie'
import { verifyTotp } from './totp.js'

// ── Config ────────────────────────────────────────────────────────────────────

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000
const COOKIE_NAME         = 'session'
const MAX_FAILURES        = 5
const LOCKOUT_MS_MIN      = 5  * 60 * 1000   //  5 min — premier blocage
const LOCKOUT_MS_MAX      = 24 * 60 * 60 * 1000  // 24 h — plafond
const AUTH_BASE_URL       = 'https://auth.wireredblue.xyz'
const DEFAULT_REDIRECT    = 'https://wireredblue.xyz'

// ── État en mémoire ───────────────────────────────────────────────────────────

let lastUsedCounter: bigint | null = null

/**
 * Backoff progressif : lockoutMs double à chaque blocage (5 min → 10 → 20 → … → 24 h).
 * Ne se réinitialise qu'après une connexion réussie.
 */
const rateLimit = { failures: 0, lockedUntil: 0, lockoutMs: LOCKOUT_MS_MIN }

// ── Sécurité : validation de l'URL de redirection ────────────────────────────

/**
 * Accepte uniquement wireredblue.xyz et ses sous-domaines.
 *
 * Le préfixe "." dans endsWith('.wireredblue.xyz') est crucial :
 *   - "photos.wireredblue.xyz"     → se termine par ".wireredblue.xyz" ✓
 *   - "evilwireredblue.xyz"        → se termine par "wireredblue.xyz" MAIS pas ".wireredblue.xyz" ✗
 *   - "wireredblue.xyz.pirate.com" → se termine par ".pirate.com", pas ".wireredblue.xyz" ✗
 */
/** Échappe les 5 caractères HTML dangereux — protège contre les XSS dans les templates. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

/** Envoie une alerte ntfy si NTFY_URL est défini dans .env. Fire-and-forget. */
function notifyLockout(lockoutMs: number): void {
  const url = process.env.NTFY_URL
  if (!url) return
  const minutes = Math.round(lockoutMs / 60_000)
  fetch(url, {
    method: 'POST',
    body: `Portier : ${MAX_FAILURES} tentatives échouées — accès verrouillé ${minutes} min`,
    headers: { Title: 'Tentative de connexion bloquée', Priority: 'high' },
  }).catch(e => console.error('ntfy:', e))
}

function isSafeRedirect(rd: string): boolean {
  try {
    const { hostname, protocol } = new URL(rd)
    if (protocol !== 'https:') return false
    return hostname === 'wireredblue.xyz' || hostname.endsWith('.wireredblue.xyz')
  } catch {
    return false
  }
}

function safeRd(rd: string | null | undefined): string {
  if (rd && isSafeRedirect(rd)) return rd
  return DEFAULT_REDIRECT
}

// ── Lecture du cookie de session ─────────────────────────────────────────────

async function getSession(c: Parameters<typeof getSignedCookie>[0]): Promise<boolean> {
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

// ── HTML ──────────────────────────────────────────────────────────────────────

const alreadyConnectedPage = () => `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Portier</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100dvh; display: flex; align-items: center; justify-content: center;
      background: #0f0f0f; font-family: 'Segoe UI', system-ui, sans-serif; color: #e0e0e0;
    }
    .card {
      background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px;
      padding: 2.5rem 2rem; width: 100%; max-width: 360px;
      display: flex; flex-direction: column; gap: 1.5rem; text-align: center;
    }
    h1 { font-size: 1.25rem; font-weight: 600; color: #fff; }
    p  { font-size: 0.85rem; color: #666; }
    button {
      width: 100%; padding: 0.75rem; border: 1px solid #333; border-radius: 8px;
      background: #222; color: #aaa; font-size: 0.9rem; cursor: pointer;
    }
    button:hover { background: #2a2a2a; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Déjà connecté</h1>
    <p>Votre session est active.</p>
    <form method="POST" action="/logout">
      <button type="submit">Se déconnecter</button>
    </form>
  </div>
</body>
</html>`

const loginPage = (opts: { rd?: string; error?: string; retryAfter?: number }) => {
  const { rd = '', error, retryAfter } = opts
  const safeRdAttr  = escapeHtml(rd)
  const safeError   = error ? escapeHtml(error) : null
  const locked = (retryAfter ?? 0) > 0
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Connexion – Portier</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100dvh; display: flex; align-items: center; justify-content: center;
      background: #0f0f0f; font-family: 'Segoe UI', system-ui, sans-serif; color: #e0e0e0;
    }
    .card {
      background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px;
      padding: 2.5rem 2rem; width: 100%; max-width: 360px;
      display: flex; flex-direction: column; gap: 1.5rem;
    }
    h1      { font-size: 1.25rem; font-weight: 600; text-align: center; color: #fff; }
    p.hint  { font-size: 0.85rem; color: #666; text-align: center; line-height: 1.5; }
    .otp-inputs { display: flex; gap: 0.5rem; justify-content: center; }
    .otp-inputs input {
      width: 2.75rem; height: 3.25rem; text-align: center;
      font-size: 1.5rem; font-weight: 600; border: 1px solid #333; border-radius: 8px;
      background: #111; color: #fff; caret-color: transparent; outline: none;
      transition: border-color 0.15s;
    }
    .otp-inputs input:focus    { border-color: #4f8ef7; }
    .otp-inputs input:disabled { opacity: 0.4; }
    .error {
      background: #2d1515; border: 1px solid #5c2020; color: #f87171;
      border-radius: 8px; padding: 0.65rem 0.85rem; font-size: 0.85rem; text-align: center;
    }
    button[type="submit"] {
      width: 100%; padding: 0.75rem; border: none; border-radius: 8px;
      background: #4f8ef7; color: #fff; font-size: 1rem; font-weight: 600;
      cursor: pointer; transition: background 0.15s;
    }
    button[type="submit"]:hover    { background: #3a7de0; }
    button[type="submit"]:active   { background: #2d6cc0; }
    button[type="submit"]:disabled { background: #2a3a50; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authentification</h1>
    <p class="hint">Entrez le code à 6 chiffres<br>généré par votre application TOTP.</p>

    ${safeError ? `<div class="error">${safeError}</div>` : ''}

    <form method="POST" action="/login" id="form">
      <input type="hidden" name="rd" value="${safeRdAttr}" />
      <div class="otp-inputs">
        ${[0,1,2,3,4,5].map(i => `<input
          type="text" inputmode="numeric" maxlength="1" pattern="[0-9]"
          autocomplete="${i === 0 ? 'one-time-code' : 'off'}"
          name="d${i}" id="d${i}"
          ${locked ? 'disabled' : ''} required
        />`).join('\n        ')}
      </div>
      <br />
      <button type="submit" ${locked ? 'disabled' : ''} id="submit-btn">Vérifier</button>
    </form>
  </div>

  <script>
    const RETRY_AFTER = ${retryAfter ?? 0}

    if (RETRY_AFTER > 0) {
      const btn    = document.getElementById('submit-btn')
      const inputs = Array.from(document.querySelectorAll('.otp-inputs input'))
      const end    = Date.now() + RETRY_AFTER * 1000
      const tick   = () => {
        const s = Math.max(0, Math.ceil((end - Date.now()) / 1000))
        btn.textContent = s > 0 ? \`Réessayer dans \${s}s\` : 'Vérifier'
        if (s > 0) { setTimeout(tick, 500) }
        else {
          btn.disabled = false
          inputs.forEach(el => { el.disabled = false })
          inputs[0].focus()
        }
      }
      tick()
    } else {
      const inputs = Array.from(document.querySelectorAll('.otp-inputs input'))
      inputs[0].focus()

      inputs.forEach((input, i) => {
        input.addEventListener('input', (e) => {
          const val = e.target.value.replace(/\\D/g, '')
          e.target.value = val.slice(-1)
          if (val && i < inputs.length - 1) inputs[i + 1].focus()
          if (inputs.every(el => el.value)) document.getElementById('form').submit()
        })
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Backspace' && !e.target.value && i > 0) {
            inputs[i - 1].focus()
            inputs[i - 1].value = ''
          }
        })
        input.addEventListener('paste', (e) => {
          e.preventDefault()
          const data = e.clipboardData.getData('text').replace(/\\D/g, '').slice(0, 6)
          data.split('').forEach((ch, j) => { if (inputs[j]) inputs[j].value = ch })
          if (data.length === 6) document.getElementById('form').submit()
          else if (inputs[data.length]) inputs[data.length].focus()
        })
      })
    }
  </script>
</body>
</html>`
}

// ── Routes ────────────────────────────────────────────────────────────────────

const app = new Hono()

/**
 * Page de connexion.
 * Accepte ?rd= pour se souvenir de la destination après login.
 */
app.get('/', async (c) => {
  if (!process.env.SESSION_SECRET) {
    console.error('SESSION_SECRET manquant dans .env')
    return c.html(loginPage({ error: 'Erreur de configuration serveur.' }), 500)
  }
  if (await getSession(c)) return c.html(alreadyConnectedPage())

  const rd = c.req.query('rd') ?? ''
  return c.html(loginPage({ rd }))
})

/**
 * Point d'entrée ForwardAuth pour Traefik.
 * Répond 200 si la session est valide, redirige vers la page de login sinon.
 * L'URL d'origine est reconstruite à partir des en-têtes X-Forwarded-*.
 */
app.get('/verify', async (c) => {
  if (!process.env.SESSION_SECRET) return c.body(null, 500)

  if (await getSession(c)) return c.body(null, 200)

  const proto = c.req.header('x-forwarded-proto') ?? 'https'
  const host  = c.req.header('x-forwarded-host')  ?? ''
  const uri   = c.req.header('x-forwarded-uri')   ?? '/'
  const origin = host ? `${proto}://${host}${uri}` : ''

  const loginUrl = new URL(AUTH_BASE_URL)
  if (origin && isSafeRedirect(origin)) {
    loginUrl.searchParams.set('rd', origin)
  }

  return c.redirect(loginUrl.toString(), 302)
})

/**
 * Vérification du code TOTP.
 * En cas de succès, pose le cookie et redirige vers rd (si sûr) ou la page par défaut.
 */
app.post('/login', async (c) => {
  const totpSecret    = process.env.TOTP_SECRET
  const sessionSecret = process.env.SESSION_SECRET

  if (!totpSecret || !sessionSecret) {
    console.error('TOTP_SECRET ou SESSION_SECRET manquant dans .env')
    return c.html(loginPage({ error: 'Erreur de configuration serveur.' }), 500)
  }

  const body = await c.req.parseBody()
  const rd   = typeof body['rd'] === 'string' ? body['rd'] : ''

  // 1. Verrouillage
  const now = Date.now()
  if (now < rateLimit.lockedUntil) {
    const retryAfter = Math.ceil((rateLimit.lockedUntil - now) / 1000)
    return c.html(loginPage({
      rd,
      error: `Trop de tentatives. Réessayez dans ${retryAfter}s.`,
      retryAfter,
    }), 429)
  }

  // 2. Format
  const token = [0,1,2,3,4,5].map(i => body[`d${i}`] ?? '').join('')
  if (!/^\d{6}$/.test(token)) {
    return c.html(loginPage({ rd, error: 'Code invalide.' }), 400)
  }

  // 3. TOTP
  const counter = verifyTotp(totpSecret, token)
  if (counter === null) {
    rateLimit.failures++
    if (rateLimit.failures >= MAX_FAILURES) {
      rateLimit.lockedUntil = Date.now() + rateLimit.lockoutMs
      rateLimit.lockoutMs   = Math.min(rateLimit.lockoutMs * 2, LOCKOUT_MS_MAX)
      rateLimit.failures    = 0
      notifyLockout(rateLimit.lockoutMs)
      const retryAfter = Math.ceil((rateLimit.lockedUntil - Date.now()) / 1000)
      return c.html(loginPage({
        rd,
        error: `Trop de tentatives. Réessayez dans ${Math.round(retryAfter / 60)} min.`,
        retryAfter,
      }), 429)
    }
    const left = MAX_FAILURES - rateLimit.failures
    return c.html(loginPage({
      rd,
      error: `Code incorrect ou expiré. (${left} tentative${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''})`,
    }), 401)
  }

  // 4. Anti-rejeu
  if (lastUsedCounter !== null && counter <= lastUsedCounter) {
    rateLimit.failures++
    return c.html(loginPage({ rd, error: 'Code déjà utilisé.' }), 401)
  }

  // 5. Succès — réinitialisation complète du rateLimit (y compris le backoff)
  lastUsedCounter       = counter
  rateLimit.failures    = 0
  rateLimit.lockedUntil = 0
  rateLimit.lockoutMs   = LOCKOUT_MS_MIN

  const payload = JSON.stringify({ exp: Date.now() + SESSION_DURATION_MS })
  const domain  = process.env.COOKIE_DOMAIN || undefined

  await setSignedCookie(c, COOKIE_NAME, payload, sessionSecret, {
    httpOnly: true,
    secure:   true,   // HTTPS only – désactiver temporairement en local HTTP si besoin
    sameSite: 'Lax',
    maxAge:   SESSION_DURATION_MS / 1000,
    path:     '/',
    ...(domain ? { domain } : {}),
  })

  return c.redirect(safeRd(rd), 303)
})

app.post('/logout', (c) => {
  const domain = process.env.COOKIE_DOMAIN || undefined
  deleteCookie(c, COOKIE_NAME, { path: '/', ...(domain ? { domain } : {}) })
  return c.redirect('/', 303)
})

// ── Serveur ───────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Portier en écoute sur http://localhost:${info.port}`)
})
