import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { deleteCookie } from 'hono/cookie'
import { verifyTotp } from './totp.js'
import { getSession, createSession, COOKIE_NAME } from './session.js'
import { escapeHtml, isSafeRedirect, safeRd } from './utils.js'
import passkeyApp from './passkey.js'

// ── Config ────────────────────────────────────────────────────────────────────

const AUTH_BASE_URL  = 'https://auth.wireredblue.xyz'
const MAX_FAILURES   = 5
const LOCKOUT_MS_MIN = 5  * 60 * 1000
const LOCKOUT_MS_MAX = 24 * 60 * 60 * 1000

// ── État en mémoire ───────────────────────────────────────────────────────────

let lastUsedCounter: bigint | null = null
const rateLimit = { failures: 0, lockedUntil: 0, lockoutMs: LOCKOUT_MS_MIN }

// ── Notifications ─────────────────────────────────────────────────────────────

function notifyLockout(lockoutMs: number): void {
  const url = process.env.NTFY_URL
  if (!url) return
  const minutes = Math.round(lockoutMs / 60_000)
  fetch(url, {
    method: 'POST',
    body: `Portier : ${MAX_FAILURES} tentatives échouées — verrouillé ${minutes} min`,
    headers: { Title: 'Connexion bloquée', Priority: 'high' },
  }).catch(e => console.error('ntfy:', e))
}

// ── HTML ──────────────────────────────────────────────────────────────────────

// CDN SimpleWebAuthn browser (même version majeure que le serveur)
const SWA_CDN = 'https://unpkg.com/@simplewebauthn/browser@14/dist/bundle/index.umd.min.js'

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
      display: flex; flex-direction: column; gap: 1.25rem;
    }
    h1 { font-size: 1.25rem; font-weight: 600; color: #fff; text-align: center; }
    p  { font-size: 0.85rem; color: #666; text-align: center; }
    .sep { border: none; border-top: 1px solid #2a2a2a; margin: 0; }
    button {
      width: 100%; padding: 0.75rem; border-radius: 8px; font-size: 0.9rem;
      cursor: pointer; transition: background 0.15s;
    }
    .btn-ghost {
      background: #222; border: 1px solid #333; color: #aaa;
    }
    .btn-ghost:hover { background: #2a2a2a; }
    .btn-primary {
      background: #4f8ef7; border: none; color: #fff; font-weight: 600;
    }
    .btn-primary:hover  { background: #3a7de0; }
    .btn-primary:disabled { background: #2a3a50; cursor: not-allowed; }
    .msg { font-size: 0.82rem; text-align: center; min-height: 1.2em; }
    .msg.ok    { color: #4ade80; }
    .msg.error { color: #f87171; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connecté</h1>
    <p>Votre session est active.</p>

    <hr class="sep" />

    <div>
      <button id="add-passkey-btn" class="btn-primary" type="button">Ajouter une passkey</button>
      <p class="msg" id="passkey-msg"></p>
    </div>

    <hr class="sep" />

    <form method="POST" action="/logout">
      <button type="submit" class="btn-ghost">Se déconnecter</button>
    </form>
  </div>

  <script src="${SWA_CDN}"></script>
  <script>
    const btn = document.getElementById('add-passkey-btn')
    const msg = document.getElementById('passkey-msg')

    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = '…'
      msg.className = 'msg'
      msg.textContent = ''

      try {
        const optRes = await fetch('/passkey/register/options')
        if (!optRes.ok) throw new Error((await optRes.json()).error)
        const options = await optRes.json()

        const regResp = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options })

        const verRes = await fetch('/passkey/register/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(regResp),
        })
        if (!verRes.ok) throw new Error((await verRes.json()).error)

        msg.className = 'msg ok'
        msg.textContent = 'Passkey ajoutée ✓'
        btn.textContent = 'Ajouter une autre passkey'
      } catch (e) {
        msg.className = 'msg error'
        msg.textContent = e.message ?? 'Erreur inconnue'
        btn.textContent = 'Ajouter une passkey'
      } finally {
        btn.disabled = false
      }
    })
  </script>
</body>
</html>`

const loginPage = (opts: { rd?: string; error?: string; retryAfter?: number }) => {
  const { rd = '', error, retryAfter } = opts
  const safeRdAttr = escapeHtml(rd)
  const safeError  = error ? escapeHtml(error) : null
  const locked     = (retryAfter ?? 0) > 0

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
      display: flex; flex-direction: column; gap: 1.25rem;
    }
    h1     { font-size: 1.25rem; font-weight: 600; text-align: center; color: #fff; }
    p.hint { font-size: 0.85rem; color: #666; text-align: center; line-height: 1.5; }
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
    .sep {
      display: flex; align-items: center; gap: 0.75rem; color: #444; font-size: 0.8rem;
    }
    .sep::before, .sep::after {
      content: ''; flex: 1; border-top: 1px solid #2a2a2a;
    }
    button {
      width: 100%; padding: 0.75rem; border-radius: 8px;
      font-size: 1rem; font-weight: 600; cursor: pointer; transition: background 0.15s;
    }
    .btn-primary { background: #4f8ef7; border: none; color: #fff; }
    .btn-primary:hover    { background: #3a7de0; }
    .btn-primary:active   { background: #2d6cc0; }
    .btn-primary:disabled { background: #2a3a50; cursor: not-allowed; }
    .btn-passkey {
      background: #1e1e1e; border: 1px solid #333; color: #ccc;
      display: flex; align-items: center; justify-content: center; gap: 0.5rem;
    }
    .btn-passkey:hover    { background: #252525; }
    .btn-passkey:disabled { opacity: 0.5; cursor: not-allowed; }
    #passkey-error { display: none; }
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
      <button type="submit" class="btn-primary" ${locked ? 'disabled' : ''} id="submit-btn">Vérifier</button>
    </form>

    <div class="sep">ou</div>

    <div>
      <button type="button" class="btn-passkey" id="passkey-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="8" cy="8" r="4"/><path d="M14 12h6m-3-3v6M2 20v-1a6 6 0 0 1 6-6h2"/>
        </svg>
        Se connecter avec une passkey
      </button>
      <div class="error" id="passkey-error"></div>
    </div>
  </div>

  <script src="${SWA_CDN}"></script>
  <script>
    const RETRY_AFTER = ${retryAfter ?? 0}

    // ── TOTP inputs ───────────────────────────────────────────────────────────
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

    // ── Passkey ───────────────────────────────────────────────────────────────
    const passkeyBtn = document.getElementById('passkey-btn')
    const passkeyErr = document.getElementById('passkey-error')

    // Masquer le bouton si WebAuthn n'est pas supporté
    if (!window.PublicKeyCredential) {
      passkeyBtn.closest('div').style.display = 'none'
      document.querySelector('.sep').style.display = 'none'
    }

    passkeyBtn.addEventListener('click', async () => {
      passkeyBtn.disabled = true
      passkeyErr.style.display = 'none'

      const rd = document.querySelector('input[name="rd"]').value

      try {
        const optRes = await fetch('/passkey/login/options')
        if (!optRes.ok) throw new Error('Aucune passkey disponible')
        const options = await optRes.json()

        const authResp = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options })

        const verRes = await fetch('/passkey/login/verify', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ ...authResp, rd }),
        })
        const data = await verRes.json()
        if (!verRes.ok) throw new Error(data.error ?? 'Échec')

        window.location.href = data.redirect
      } catch (e) {
        if (e.name !== 'NotAllowedError') {
          passkeyErr.textContent = e.message ?? 'Erreur inconnue'
          passkeyErr.style.display = 'block'
        }
        passkeyBtn.disabled = false
      }
    })
  </script>
</body>
</html>`
}

// ── Application ───────────────────────────────────────────────────────────────

const app = new Hono()

app.route('/passkey', passkeyApp)

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
 * ForwardAuth Traefik : 200 si session valide, 302 vers login sinon.
 */
app.get('/verify', async (c) => {
  if (!process.env.SESSION_SECRET) return c.body(null, 500)
  if (await getSession(c)) return c.body(null, 200)

  const proto  = c.req.header('x-forwarded-proto') ?? 'https'
  const host   = c.req.header('x-forwarded-host')  ?? ''
  const uri    = c.req.header('x-forwarded-uri')   ?? '/'
  const origin = host ? `${proto}://${host}${uri}` : ''

  const loginUrl = new URL(AUTH_BASE_URL)
  if (origin && isSafeRedirect(origin)) loginUrl.searchParams.set('rd', origin)

  return c.redirect(loginUrl.toString(), 302)
})

/**
 * Vérification du code TOTP.
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
    return c.html(loginPage({ rd, error: `Trop de tentatives. Réessayez dans ${Math.round(retryAfter / 60)} min.`, retryAfter }), 429)
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
      return c.html(loginPage({ rd, error: `Trop de tentatives. Réessayez dans ${Math.round(retryAfter / 60)} min.`, retryAfter }), 429)
    }
    const left = MAX_FAILURES - rateLimit.failures
    return c.html(loginPage({ rd, error: `Code incorrect ou expiré. (${left} tentative${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''})` }), 401)
  }

  // 4. Anti-rejeu TOTP
  if (lastUsedCounter !== null && counter <= lastUsedCounter) {
    rateLimit.failures++
    return c.html(loginPage({ rd, error: 'Code déjà utilisé.' }), 401)
  }

  // 5. Succès
  lastUsedCounter       = counter
  rateLimit.failures    = 0
  rateLimit.lockedUntil = 0
  rateLimit.lockoutMs   = LOCKOUT_MS_MIN

  await createSession(c)
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
