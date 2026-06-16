import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// One row per on-chain access (purchase or claim_free). Anti-replay: the receipt
// id is unique and only marked 'done' after a successful analysis (consume-on-success).
export const analysisPayments = pgTable('analysis_payments', {
  receiptId: text('receipt_id').primaryKey(),
  walletAddress: text('wallet_address').notNull(),
  modelId: integer('model_id').notNull(),
  marketId: text('market_id'),
  blobId: text('blob_id'),
  status: text('status').default('pending').notNull(), // 'pending' | 'done'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export type AnalysisPayment = typeof analysisPayments.$inferSelect;
