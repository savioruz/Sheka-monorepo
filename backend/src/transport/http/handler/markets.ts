import type { Database } from '@db/index';
import { analysisPayments } from '@db/schema/analysis-payments';
import { markets } from '@db/schema/markets';
import { models } from '@db/schema/models';
import type { AnalysisService } from '@domains/analysis/service';
import type { MarketService } from '@domains/market/service';
import type { Analyst } from '@domains/prediction/analyst';
import type { Ingestor } from '@domains/prediction/ingestor';
import { recommendOutcome } from '@domains/prediction/recommend';
import type { Sport } from '@domains/prediction/types';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import { error, success } from '../response';

const OUTCOME_LABEL = ['Home', 'Draw', 'Away'];

export interface MarketsDeps {
  db: Database;
  marketService: MarketService;
  ingestor: Ingestor;
  analyst: Analyst;
  analysisService: AnalysisService;
}

export function registerMarketsRoutes(app: Hono, deps: MarketsDeps) {
  const { db, marketService, ingestor, analyst, analysisService } = deps;

  const analyzeSchema = z.object({
    model_id: z.number().int().min(0),
    access_tx_digest: z.string().min(1),
  });

  // Paid (or free-quota) AI analysis: verify on-chain access, run the chosen
  // model, return the 3-way pick. Consume-on-success (failures are retryable).
  app.post('/api/markets/:id/analyze', zValidator('json', analyzeSchema), async (c) => {
    const walletAddress = c.get('walletAddress') as string | undefined;
    if (!walletAddress) return c.json(error('unauthorized', 'Wallet not authenticated'), 401);

    const marketObjectId = c.req.param('id');
    const { model_id, access_tx_digest } = c.req.valid('json');

    const [row] = await db
      .select()
      .from(markets)
      .where(eq(markets.marketObjectId, marketObjectId))
      .limit(1);
    if (!row) return c.json(error('not_found', 'Market not found'), 404);

    const [model] = await db.select().from(models).where(eq(models.id, model_id)).limit(1);
    if (!model || !model.active) return c.json(error('bad_model', 'Unknown model'), 400);

    // 1) Verify the on-chain access (purchase or claim_free) for this wallet+model.
    const access = await analysisService.verifyAccess(access_tx_digest, walletAddress, model_id);
    if (!access.ok || !access.receiptId) {
      return c.json(error('access_invalid', access.error ?? 'Access verification failed'), 402);
    }
    // 2) Anti-replay: a receipt yields exactly one analysis.
    const prior = await db
      .select()
      .from(analysisPayments)
      .where(eq(analysisPayments.receiptId, access.receiptId))
      .limit(1);
    if (prior.length > 0 && prior[0].status === 'done') {
      return c.json(error('already_used', 'This access was already consumed'), 409);
    }

    // 3) Run — on failure we DON'T consume, so the user can retry the same access.
    const game = await ingestor.fetchGameContext(row.eventId, row.sport as Sport, row.league);
    if (!game) {
      return c.json(success({ skip: true, message: 'Could not fetch game data — try again.' }));
    }
    const analysis = await analyst.analyzeGame(game, model.key);
    if (analysis.skip) {
      return c.json(
        success({ skip: true, message: 'The model could not read this game — retry.' }),
      );
    }

    const state = await marketService.getMarketState(marketObjectId);
    const probs = [
      analysis.homeWinProbability,
      analysis.drawProbability,
      analysis.awayWinProbability,
    ];
    const rec = recommendOutcome(probs, state?.pools ?? [0, 0, 0], state?.total ?? 0);
    const recommendation = {
      outcome: rec.outcome,
      label: OUTCOME_LABEL[rec.outcome],
      edge: Math.round(rec.edge * 1000) / 10,
      has_edge: rec.edge > 0,
      model_probs: probs.map((p) => Math.round(p * 1000) / 10),
      implied_prob: Math.round(rec.impliedProb * 1000) / 10,
      confidence_tier: analysis.confidenceTier,
      reasoning: analysis.reasoning,
    };

    // 4) Seal-encrypt the result and store it on Walrus (owner-decryptable).
    const blobId = await analysisService.encryptAndStore(access.receiptId, {
      market: { home: row.homeTeam, away: row.awayTeam, league: row.league },
      model: model.label,
      ...recommendation,
    });

    // 5) Consume-on-success.
    await db
      .insert(analysisPayments)
      .values({
        receiptId: access.receiptId,
        walletAddress,
        modelId: model_id,
        marketId: marketObjectId,
        blobId,
        status: 'done',
      })
      .onConflictDoUpdate({
        target: analysisPayments.receiptId,
        set: { status: 'done', blobId, updatedAt: new Date() },
      });

    return c.json(
      success({
        model: model.label,
        receipt_id: access.receiptId,
        blob_id: blobId,
        recommendation,
      }),
    );
  });

  // Auto-resolve from the ESPN final score. Safe to leave open: the winner is
  // derived from the real final score (never caller-supplied) and it 409s unless
  // the game is final. Market create + normal settlement run via the market-sync
  // scheduler (admin-keypair signed, off the public API).
  app.post('/api/markets/:id/resolve-auto', async (c) => {
    const marketObjectId = c.req.param('id');
    const [row] = await db
      .select()
      .from(markets)
      .where(eq(markets.marketObjectId, marketObjectId))
      .limit(1);
    if (!row) return c.json(error('not_found', 'Market not found'), 404);

    const game = await ingestor.fetchGameContext(row.eventId, row.sport as Sport, row.league);
    if (!game) return c.json(error('no_game', 'Could not fetch game from ESPN'), 502);
    if (game.status !== 'final') {
      return c.json(error('not_final', `Game is not final (status: ${game.status})`), 409);
    }
    const home = game.homeTeam.score ?? 0;
    const away = game.awayTeam.score ?? 0;
    const winner = home > away ? 0 : home === away ? 1 : 2;

    try {
      const digest = await marketService.resolveMarket(marketObjectId, winner);
      await db
        .update(markets)
        .set({ status: 'resolved', winner, resolveTxDigest: digest, updatedAt: new Date() })
        .where(eq(markets.marketObjectId, marketObjectId));
      return c.json(
        success({
          market_object_id: marketObjectId,
          winner,
          score: `${home}-${away}`,
          tx_digest: digest,
        }),
      );
    } catch (err) {
      return c.json(error('resolve_failed', err instanceof Error ? err.message : String(err)), 502);
    }
  });

  // Shape a DB market row with its live on-chain pools + implied odds (%).
  type MarketRow = typeof markets.$inferSelect;
  async function enrichMarket(m: MarketRow) {
    const state = await marketService.getMarketState(m.marketObjectId);
    const pools = state?.pools ?? [0, 0, 0];
    const total = state?.total ?? 0;
    const impliedOdds = pools.map((p) => (total > 0 ? Math.round((p / total) * 1000) / 10 : 0));
    return {
      market_object_id: m.marketObjectId,
      event_id: m.eventId,
      sport: m.sport,
      league: m.league,
      home: m.homeTeam,
      away: m.awayTeam,
      home_logo: m.homeLogo,
      away_logo: m.awayLogo,
      scheduled_at: m.scheduledAt ? m.scheduledAt.toISOString() : null,
      status: state ? (state.status === 1 ? 'resolved' : 'open') : m.status,
      winner: state?.winner ?? m.winner,
      pools,
      total,
      implied_odds: impliedOdds, // [home %, draw %, away %]
      // Live ESPN match status (refreshed by market-sync); drives the "45'"/"HT" chip.
      status_detail: m.statusDetail,
      period: m.period,
      clock: m.clock,
    };
  }

  // Public: list markets with live on-chain pools + implied odds (%).
  app.get('/api/markets', async (c) => {
    const rows = await db.select().from(markets);
    const enriched = await Promise.all(rows.map(enrichMarket));
    return c.json(success({ markets: enriched }));
  });

  // Public: a single market (for the /market/[id] detail page).
  app.get('/api/markets/:id', async (c) => {
    const marketObjectId = c.req.param('id');
    const [row] = await db
      .select()
      .from(markets)
      .where(eq(markets.marketObjectId, marketObjectId))
      .limit(1);
    if (!row) return c.json(error('not_found', 'Market not found'), 404);
    return c.json(success({ market: await enrichMarket(row) }));
  });

  // Public: ESPN news relevant to a market — league news filtered to the two
  // teams (falls back to recent league news when few match). Best-effort: returns
  // an empty list if the upstream ESPN service is unavailable.
  app.get('/api/markets/:id/news', async (c) => {
    const marketObjectId = c.req.param('id');
    const [row] = await db
      .select()
      .from(markets)
      .where(eq(markets.marketObjectId, marketObjectId))
      .limit(1);
    if (!row) return c.json(error('not_found', 'Market not found'), 404);

    let articles: {
      id: number | null;
      headline: string;
      description: string;
      published: string | null;
      thumbnail: string | null;
      type: string | null;
    }[] = [];
    try {
      const raw = await ingestor.fetchRelevantNews(row.sport as Sport, row.league, [
        row.homeTeam,
        row.awayTeam,
      ]);
      articles = raw.map((a) => ({
        id: a.id ?? null,
        headline: a.headline,
        description: a.description ?? '',
        published: a.published ?? null,
        thumbnail: a.thumbnail ?? null,
        type: a.type ?? null,
      }));
    } catch {
      /* best-effort: empty list on upstream failure */
    }
    return c.json(success({ articles }));
  });
}
