import type { Database } from '@db/index';
import { markets } from '@db/schema/markets';
import { eq } from 'drizzle-orm';

export interface MarketRepositoryDeps {
  db: Database;
}

/**
 * Data-access for the market domain — every drizzle query on the local `markets`
 * cache. The service holds the on-chain logic and never sees SQL.
 */
export function createMarketRepository(deps: MarketRepositoryDeps) {
  const { db } = deps;

  return {
    /** One market row by its on-chain object id, or undefined. */
    async getByObjectId(marketObjectId: string) {
      const [row] = await db
        .select()
        .from(markets)
        .where(eq(markets.marketObjectId, marketObjectId))
        .limit(1);
      return row;
    },

    /** All market rows. */
    listAll() {
      return db.select().from(markets);
    },

    /** Mark a market resolved (winner + settle tx digest). */
    async markResolved(
      marketObjectId: string,
      winner: number,
      resolveTxDigest: string,
    ): Promise<void> {
      await db
        .update(markets)
        .set({ status: 'resolved', winner, resolveTxDigest, updatedAt: new Date() })
        .where(eq(markets.marketObjectId, marketObjectId));
    },

    /** Mark a market terminally voided (auto/manual) — resolved with a reason. */
    async markVoided(
      marketObjectId: string,
      winner: number,
      resolveTxDigest: string,
    ): Promise<void> {
      await db
        .update(markets)
        .set({
          status: 'resolved',
          winner,
          resolveTxDigest,
          resolvedReason: 'auto_void',
          updatedAt: new Date(),
        })
        .where(eq(markets.marketObjectId, marketObjectId));
    },
  };
}

export type MarketRepository = ReturnType<typeof createMarketRepository>;
