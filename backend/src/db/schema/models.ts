import { bigint, boolean, integer, pgTable, text } from 'drizzle-orm/pg-core';

// AI models offered for analysis. `id` matches the on-chain model_id used by the
// sheka_analysis price registry. `key` is the OpenRouter model string.
export const models = pgTable('models', {
  id: integer('id').primaryKey(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  priceMist: bigint('price_mist', { mode: 'number' }).notNull(),
  free: boolean('free').default(false).notNull(),
  active: boolean('active').default(true).notNull(),
  sort: integer('sort').default(0).notNull(),
});

export type ModelRow = typeof models.$inferSelect;
