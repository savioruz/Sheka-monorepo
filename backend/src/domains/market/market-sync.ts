import type { Config } from '@config/config';
import type { Database } from '@db/index';
import { markets } from '@db/schema/markets';
import type { MarketService } from '@domains/market/service';
import type { Ingestor } from '@domains/prediction/ingestor';
import type { GameSnapshot, Sport } from '@domains/prediction/types';
import type { Logger } from '@infras/logger/logger';
import { eq } from 'drizzle-orm';

export interface MarketSyncDeps {
  config: Config;
  db: Database;
  logger: Logger;
  ingestor: Ingestor;
  marketService: MarketService;
}

/** Winner outcome from a final score: 0 home, 1 draw, 2 away. */
export function winnerFromScore(home: number, away: number): number {
  return home > away ? 0 : home === away ? 1 : 2;
}

/**
 * Autonomous market lifecycle driven by ESPN. Runs on the same schedule as the
 * ESPN sync: open a market for each new upcoming/live game, and resolve markets
 * whose game has finished. The platform admin keypair signs every tx, so there
 * is no manual operator step and no end-user admin rights.
 */
export function createMarketSync(deps: MarketSyncDeps) {
  const { config, db, logger, ingestor, marketService } = deps;

  // Re-entrancy guard: resolveFinishedMarkets runs both on the 15-min full sync
  // and the ~60s settlement pass; don't let two runs overlap.
  let resolving = false;

  // A game that hasn't reported `final` this long after kickoff is treated as
  // stale (frozen upstream); we nudge a re-ingest, throttled per market.
  const STALE_GRACE_MS = 4 * 60 * 60 * 1000; // 4h
  const REFRESH_THROTTLE_MS = 10 * 60 * 1000; // ≤ once / 10 min per market
  const lastRefresh = new Map<string, number>();

  /** Open on-chain markets for upcoming/live games that don't have one yet. */
  async function createMissingMarkets(): Promise<void> {
    let games: GameSnapshot[] | undefined;
    try {
      games = await ingestor.fetchGames();
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'market-sync: fetchGames failed',
      );
      return;
    }

    const candidates = games
      .filter((g) => g.status === 'scheduled' || g.status === 'in_progress')
      .slice(0, config.market.autoCreateLimit);

    let created = 0;
    for (const game of candidates) {
      try {
        const existing = await db
          .select({ id: markets.id, homeLogo: markets.homeLogo })
          .from(markets)
          .where(eq(markets.eventId, game.eventId))
          .limit(1);
        if (existing.length > 0) {
          // Backfill logos on a pre-existing market (created before logo columns).
          if (!existing[0].homeLogo && game.homeTeam.logo) {
            await db
              .update(markets)
              .set({
                homeLogo: game.homeTeam.logo,
                awayLogo: game.awayTeam.logo ?? null,
                updatedAt: new Date(),
              })
              .where(eq(markets.eventId, game.eventId));
          }
          continue;
        }

        const result = await marketService.createMarket(
          game.eventId,
          game.homeTeam.displayName,
          game.awayTeam.displayName,
        );
        await db.insert(markets).values({
          marketObjectId: result.marketObjectId,
          eventId: game.eventId,
          sport: game.sport,
          league: game.league,
          homeTeam: game.homeTeam.displayName,
          awayTeam: game.awayTeam.displayName,
          homeLogo: game.homeTeam.logo ?? null,
          awayLogo: game.awayTeam.logo ?? null,
          scheduledAt: game.scheduledAt ? new Date(game.scheduledAt) : null,
          createTxDigest: result.digest,
        });
        created += 1;
        logger.info(
          { eventId: game.eventId, marketObjectId: result.marketObjectId },
          'market-sync: auto-created market',
        );
      } catch (err) {
        logger.warn(
          { eventId: game.eventId, error: err instanceof Error ? err.message : String(err) },
          'market-sync: create failed (will retry next run)',
        );
      }
    }
    if (created > 0) logger.info({ created }, 'market-sync: createMissingMarkets done');
  }

  /** Resolve open markets whose ESPN game is final, using the real score. */
  async function resolveFinishedMarkets(): Promise<void> {
    if (resolving) return;
    resolving = true;
    try {
      await resolveFinishedMarketsInner();
    } finally {
      resolving = false;
    }
  }

  async function resolveFinishedMarketsInner(): Promise<void> {
    const open = await db.select().from(markets).where(eq(markets.status, 'open'));
    // A game can only be final once its kickoff has passed; skip future markets so
    // a frequent (~60s) settlement pass only fetches games that are live/just-ended.
    const cutoff = Date.now() + 5 * 60 * 1000; // small lookahead around kickoff
    let resolved = 0;
    for (const row of open) {
      if (row.scheduledAt && row.scheduledAt.getTime() > cutoff) continue;
      try {
        const game = await ingestor.fetchGameContext(row.eventId, row.sport as Sport, row.league);
        if (!game) continue;

        // Always refresh the live match status (drives the "45'"/"HT" chip), and
        // backfill kickoff/logos on markets created before those columns existed.
        // Cheap — reuses this fetch.
        const patch: Partial<typeof markets.$inferInsert> = {
          statusDetail: game.statusDetail ?? null,
          period: game.period ?? null,
          clock: game.clock ?? null,
          statusUpdatedAt: new Date(),
        };
        if (!row.scheduledAt && game.scheduledAt) patch.scheduledAt = new Date(game.scheduledAt);
        if (!row.homeLogo && game.homeTeam.logo) patch.homeLogo = game.homeTeam.logo;
        if (!row.awayLogo && game.awayTeam.logo) patch.awayLogo = game.awayTeam.logo;
        await db
          .update(markets)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(markets.marketObjectId, row.marketObjectId));

        if (game.status !== 'final') {
          // Stale guard: kickoff well past but the source still isn't final → the
          // upstream is likely frozen. Nudge a re-ingest (throttled per market).
          const kickoff = row.scheduledAt?.getTime() ?? null;
          if (kickoff && Date.now() - kickoff > STALE_GRACE_MS) {
            const last = lastRefresh.get(row.marketObjectId) ?? 0;
            if (Date.now() - last > REFRESH_THROTTLE_MS) {
              lastRefresh.set(row.marketObjectId, Date.now());
              void ingestor.refreshScoreboard(row.sport as Sport, row.league, new Date(kickoff));
            }
          }
          continue;
        }

        const winner = winnerFromScore(game.homeTeam.score ?? 0, game.awayTeam.score ?? 0);
        const digest = await marketService.resolveMarket(row.marketObjectId, winner);
        await db
          .update(markets)
          .set({ status: 'resolved', winner, resolveTxDigest: digest, updatedAt: new Date() })
          .where(eq(markets.marketObjectId, row.marketObjectId));
        resolved += 1;
        logger.info({ marketObjectId: row.marketObjectId, winner }, 'market-sync: auto-resolved');
      } catch (err) {
        logger.warn(
          {
            marketObjectId: row.marketObjectId,
            error: err instanceof Error ? err.message : String(err),
          },
          'market-sync: resolve failed (will retry next run)',
        );
      }
    }
    if (resolved > 0) logger.info({ resolved }, 'market-sync: resolveFinishedMarkets done');
  }

  async function runOnce(): Promise<void> {
    await createMissingMarkets();
    await resolveFinishedMarkets();
  }

  return { runOnce, createMissingMarkets, resolveFinishedMarkets };
}

export type MarketSync = ReturnType<typeof createMarketSync>;
