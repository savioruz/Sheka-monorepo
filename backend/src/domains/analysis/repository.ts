import type { Database } from '@db/index';
import { analysisPayments } from '@db/schema/analysis-payments';
import { models } from '@db/schema/models';
import { traced } from '@infras/otel/otel';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';

export interface AnalysisRepositoryDeps {
  db: Database;
}

export interface RecordAnalysisInput {
  receiptId: string;
  walletAddress: string;
  modelId: number;
  marketId: string;
  blobId: string | null;
  publicBlobId: string | null;
  contentSha256: string | null;
}

/**
 * Data-access for the analysis domain. Owns every drizzle query touching `models`
 * and `analysis_payments`; the service holds the business logic and never sees SQL.
 */
export function createAnalysisRepository(deps: AnalysisRepositoryDeps) {
  const { db } = deps;

  return {
    /** Idempotently seed the model catalog (ids match the on-chain price registry). */
    async insertSeedModels(seed: (typeof models.$inferInsert)[]): Promise<void> {
      await db.insert(models).values(seed).onConflictDoNothing();
    },

    /** Active model catalog ordered by sort. */
    listActiveModels() {
      return traced('models.list', () =>
        db.select().from(models).where(eq(models.active, true)).orderBy(asc(models.sort)),
      );
    },

    /** One model row by id, or undefined. */
    async getModelById(modelId: number) {
      const [m] = await db.select().from(models).where(eq(models.id, modelId)).limit(1);
      return m;
    },

    /** The payment row for a receipt, or undefined (anti-replay lookup). */
    async getPaymentByReceipt(receiptId: string) {
      const [row] = await db
        .select()
        .from(analysisPayments)
        .where(eq(analysisPayments.receiptId, receiptId))
        .limit(1);
      return row;
    },

    /** A wallet's completed analyses (newest-first). */
    listOwnedPayments(walletAddress: string) {
      return traced('analyses.mine', () =>
        db
          .select()
          .from(analysisPayments)
          .where(
            and(
              eq(analysisPayments.walletAddress, walletAddress),
              eq(analysisPayments.status, 'done'),
            ),
          )
          .orderBy(desc(analysisPayments.createdAt)),
      );
    },

    /** Consume-on-success upsert: mark the payment 'done' with its Walrus blob refs. */
    async upsertPaymentDone(args: RecordAnalysisInput): Promise<void> {
      const { receiptId, walletAddress, modelId, marketId, blobId, publicBlobId, contentSha256 } =
        args;
      await db
        .insert(analysisPayments)
        .values({
          receiptId,
          walletAddress,
          modelId,
          marketId,
          blobId,
          publicBlobId,
          contentSha256,
          status: 'done',
        })
        .onConflictDoUpdate({
          target: analysisPayments.receiptId,
          set: { status: 'done', blobId, publicBlobId, contentSha256, updatedAt: new Date() },
        });
    },

    /** Public ledger rows: completed analyses with a public proof, + model label. */
    listProofFeed(limit: number) {
      return traced('analyses.feed', () =>
        db
          .select({
            marketId: analysisPayments.marketId,
            modelId: analysisPayments.modelId,
            modelLabel: models.label,
            publicBlobId: analysisPayments.publicBlobId,
            contentSha256: analysisPayments.contentSha256,
            createdAt: analysisPayments.createdAt,
          })
          .from(analysisPayments)
          .leftJoin(models, eq(analysisPayments.modelId, models.id))
          .where(and(eq(analysisPayments.status, 'done'), isNotNull(analysisPayments.publicBlobId)))
          .orderBy(desc(analysisPayments.createdAt))
          .limit(limit),
      );
    },
  };
}

export type AnalysisRepository = ReturnType<typeof createAnalysisRepository>;
