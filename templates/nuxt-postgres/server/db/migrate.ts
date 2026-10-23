// Lancé par `docker compose run --rm migrate` à chaque déploiement (voir deploy.sh).
// Applique uniquement les migrations générées avec `npm run db:generate`.
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const client = postgres(process.env.DATABASE_URL!, { max: 1 })
await migrate(drizzle(client), { migrationsFolder: './drizzle' })
await client.end()
console.log('Migrations appliquées')
