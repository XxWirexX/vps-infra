import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { logger } from 'hono/logger'

const app = new Hono()

app.use(logger())

app.get('/', (c) => c.json({ name: '__PROJECT_NAME__', host: '__PROJECT_HOST__' }))
app.get('/health', (c) => c.json({ ok: true }))

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`__PROJECT_NAME__ écoute sur le port ${info.port}`)
})
