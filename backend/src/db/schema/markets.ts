import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const markets = pgTable('markets', {
  id: uuid('id').primaryKey().defaultRandom(),
  marketObjectId: text('market_object_id').unique().notNull(),
  eventId: text('event_id').notNull(),
  sport: text('sport').notNull(),
  league: text('league').notNull(),
  homeTeam: text('home_team').notNull(),
  awayTeam: text('away_team').notNull(),
  homeLogo: text('home_logo'),
  awayLogo: text('away_logo'),
  // ESPN kickoff time, captured at creation; drives the Live/Starting-Soon/Upcoming tabs.
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  // mirror of on-chain status for convenience; on-chain is source of truth
  status: text('status').default('open').notNull(),
  winner: integer('winner'),
  // Live ESPN match status, refreshed by market-sync's per-open-market poll.
  // statusDetail e.g. "1st Half"/"Halftime"/"Full Time"; clock e.g. "45'".
  statusDetail: text('status_detail'),
  period: integer('period'),
  clock: text('clock'),
  statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }),
  createTxDigest: text('create_tx_digest'),
  resolveTxDigest: text('resolve_tx_digest'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type Market = typeof markets.$inferSelect;
export type NewMarket = typeof markets.$inferInsert;
