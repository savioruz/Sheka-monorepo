import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const nonces = pgTable('nonces', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type').notNull(), // 'nonce' | 'session'
  token: text('token').unique().notNull(),
  walletAddress: text('wallet_address').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Nonce = typeof nonces.$inferSelect;
export type NewNonce = typeof nonces.$inferInsert;
