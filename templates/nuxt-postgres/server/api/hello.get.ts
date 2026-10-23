import { sql } from 'drizzle-orm'
import { db, schema } from '../db'

export default defineEventHandler(async () => {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.notes)
  return {
    message: `Le serveur Nuxt répond sur __PROJECT_HOST__, et la base contient ${count} note(s).`,
  }
})
