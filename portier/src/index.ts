import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { verifyTotp } from './totp.js'

const app = new Hono()

const loginPage = (error?: string) => `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Connexion</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f0f0f;
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #e0e0e0;
    }

    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 2.5rem 2rem;
      width: 100%;
      max-width: 360px;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .card h1 {
      font-size: 1.25rem;
      font-weight: 600;
      text-align: center;
      color: #fff;
    }

    .card p.hint {
      font-size: 0.85rem;
      color: #666;
      text-align: center;
      line-height: 1.5;
    }

    .otp-inputs {
      display: flex;
      gap: 0.5rem;
      justify-content: center;
    }

    .otp-inputs input {
      width: 2.75rem;
      height: 3.25rem;
      text-align: center;
      font-size: 1.5rem;
      font-weight: 600;
      border: 1px solid #333;
      border-radius: 8px;
      background: #111;
      color: #fff;
      caret-color: transparent;
      outline: none;
      transition: border-color 0.15s;
    }

    .otp-inputs input:focus {
      border-color: #4f8ef7;
    }

    .error {
      background: #2d1515;
      border: 1px solid #5c2020;
      color: #f87171;
      border-radius: 8px;
      padding: 0.65rem 0.85rem;
      font-size: 0.85rem;
      text-align: center;
    }

    button[type="submit"] {
      width: 100%;
      padding: 0.75rem;
      border: none;
      border-radius: 8px;
      background: #4f8ef7;
      color: #fff;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }

    button[type="submit"]:hover { background: #3a7de0; }
    button[type="submit"]:active { background: #2d6cc0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authentification</h1>
    <p class="hint">Entrez le code à 6 chiffres<br>généré par votre application TOTP.</p>

    ${error ? `<div class="error">${error}</div>` : ''}

    <form method="POST" action="/verify" id="form">
      <div class="otp-inputs">
        ${[0,1,2,3,4,5].map(i => `<input
          type="text"
          inputmode="numeric"
          maxlength="1"
          pattern="[0-9]"
          autocomplete="${i === 0 ? 'one-time-code' : 'off'}"
          name="d${i}"
          id="d${i}"
          required
        />`).join('\n        ')}
      </div>
      <br />
      <button type="submit">Vérifier</button>
    </form>
  </div>

  <script>
    const inputs = Array.from(document.querySelectorAll('.otp-inputs input'))

    inputs[0].focus()

    inputs.forEach((input, i) => {
      input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '')
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
        const data = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
        data.split('').forEach((ch, j) => { if (inputs[j]) inputs[j].value = ch })
        if (data.length === 6) document.getElementById('form').submit()
        else if (inputs[data.length]) inputs[data.length].focus()
      })
    })
  </script>
</body>
</html>`

app.get('/', (c) => c.html(loginPage()))

app.post('/verify', async (c) => {
  const body = await c.req.parseBody()
  const token = [0,1,2,3,4,5].map(i => body[`d${i}`] ?? '').join('')

  const secret = process.env.TOTP_SECRET
  if (!secret) {
    console.error('TOTP_SECRET manquant dans .env')
    return c.html(loginPage('Erreur de configuration serveur.'), 500)
  }

  if (token.length !== 6 || !/^\d{6}$/.test(token)) {
    return c.html(loginPage('Code invalide.'), 400)
  }

  if (!verifyTotp(secret, token)) {
    return c.html(loginPage('Code incorrect ou expiré.'), 401)
  }

  return c.text('Accès autorisé ✓', 200)
})

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Portier en écoute sur http://localhost:${info.port}`)
})
