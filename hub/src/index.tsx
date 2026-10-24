import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { FC } from 'hono/jsx'
import { DOMAIN, PORT, TOOLS } from './config.js'
import { isLoggedIn } from './auth.js'
import { healthOf } from './health.js'
import { loadSites, type HubSite } from './sites.js'

const app = new Hono()

// En-têtes de sécurité, et pas de cache : la page change selon que l'on est connecté ou non
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('X-Frame-Options', 'DENY')
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  )
})

app.use('/static/*', serveStatic({ root: './public', rewriteRequestPath: (p) => p.replace(/^\/static/, '') }))

// ── Composants ────────────────────────────────────────────────────────────────

const Card: FC<{ name: string; host: string; description?: string; up?: boolean; maintenance?: boolean; tag?: string }> = (p) => (
  <a class={`card${p.maintenance ? ' card-maint' : ''}`} href={`https://${p.host}`} rel="noopener">
    <div class="card-head">
      <span class="name">{p.name}</span>
      {p.maintenance ? (
        <span class="status maint" title="En maintenance">maintenance</span>
      ) : p.up === undefined ? null : (
        <span class={`dot ${p.up ? 'up' : 'down'}`} title={p.up ? 'En ligne' : 'Hors ligne'}>
          <span class="sr">{p.up ? 'en ligne' : 'hors ligne'}</span>
        </span>
      )}
    </div>
    {p.description ? <p class="desc">{p.description}</p> : null}
    <span class="host">
      {p.host}
      {p.tag ? <span class="tag">{p.tag}</span> : null}
    </span>
  </a>
)

const Section: FC<{ title: string; sites: HubSite[]; health: Map<string, boolean>; note?: string }> = (p) =>
  p.sites.length ? (
    <section>
      <h2>
        {p.title}
        {p.note ? <span class="note">{p.note}</span> : null}
      </h2>
      <div class="grid">
        {p.sites.map((s) => (
          <Card name={s.name} host={s.host} description={s.description} up={p.health.get(s.id)} maintenance={s.maintenance} />
        ))}
      </div>
    </section>
  ) : null

// ── Page ──────────────────────────────────────────────────────────────────────

app.get('/', async (c) => {
  const [loggedIn, sites] = await Promise.all([isLoggedIn(c.req.header('cookie')), loadSites()])

  const publicSites = sites.filter((s) => s.visibility === 'public')
  const privateSites = loggedIn ? sites.filter((s) => s.visibility === 'private') : []
  const health = await healthOf([...publicSites, ...privateSites])
  const loginUrl = `https://auth.${DOMAIN}/?rd=${encodeURIComponent(`https://hub.${DOMAIN}/`)}`

  c.header('Cache-Control', 'private, no-store')
  c.header('Vary', 'Cookie')

  return c.html(
    '<!doctype html>' +
      (
        <html lang="fr">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Hub · {DOMAIN}</title>
            <meta name="description" content={`Les projets en ligne sur ${DOMAIN}.`} />
            <meta name="color-scheme" content="dark" />
            <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%234f8ef7'/%3E%3Cpath d='M9 9h4v14H9zM19 9h4v14h-4zM13 14h6v4h-6z' fill='white'/%3E%3C/svg%3E" />
            <link rel="stylesheet" href="/static/style.css" />
          </head>
          <body>
            <main>
              <header>
                <div>
                  <h1>Hub</h1>
                  <p class="sub">{DOMAIN}</p>
                </div>
                {loggedIn ? (
                  <span class="session">
                    <span class="dot up" /> Connecté
                  </span>
                ) : (
                  <a class="login" href={loginUrl}>
                    Connexion
                  </a>
                )}
              </header>

              <Section title="Projets" sites={publicSites} health={health} />
              {loggedIn ? <Section title="Privé" note="visible par toi seul" sites={privateSites} health={health} /> : null}

              {loggedIn ? (
                <section>
                  <h2>Outils</h2>
                  <div class="grid">
                    {TOOLS.map((t) => (
                      <Card name={t.name} host={t.host} description={t.description} />
                    ))}
                  </div>
                </section>
              ) : null}

              {!publicSites.length && !loggedIn ? <p class="empty">Rien à afficher pour l'instant.</p> : null}
            </main>
          </body>
        </html>
      ).toString(),
  )
})

app.get('/health', (c) => c.json({ ok: true }))

app.notFound((c) => c.text('Page introuvable', 404))

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`[hub] en écoute sur le port ${info.port}`)
})
