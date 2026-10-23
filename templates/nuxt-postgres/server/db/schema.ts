import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

/** Table d'exemple, à remplacer par les tiennes. */
export const notes = pgTable('notes', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
