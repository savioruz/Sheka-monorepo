import type { Database } from '@db/index';
import { analysisPayments } from '@db/schema/analysis-payments';
import { markets } from '@db/schema/markets';
import { models } from '@db/schema/models';
import type { AnalysisJobs } from '@domains/analysis/jobs';
import type { AnalysisService } from '@domains/analysis/service';
import type { MarketService } from '@domains/market/service';
import type { Analyst } from '@domains/prediction/analyst';
import type { Ingestor } from '@domains/prediction/ingestor';
import { recommendOutcome } from '@domains/prediction/recommend';
import type { GameSnapshot } from '@domains/prediction/types';
import type { Sport } from '@domains/prediction/types';
import { zValidator } from '@hono/zod-validator';
import { traced } from '@infras/otel/otel';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { error, success } from '../response';

const OUTCOME_LABEL = ['Home', 'Draw', 'Away'];

export interface MarketsDeps {
  db: Database;
  marketService: MarketService;
  ingestor: Ingestor;
  analyst: Analyst;
  analysisService: AnalysisService;
  analysisJobs: AnalysisJobs;
}

export function registerMarketsRoutes(app: Hono, deps: MarketsDeps) {
  const { db, marketService, ingestor, analyst, analysisService, analysisJobs } = deps;

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
    const access = await traced('markets.analyze.verifyAccess', () =>
      analysisService.verifyAccess(access_tx_digest, walletAddress, model_id),
    );
    if (!access.ok || !access.receiptId) {
      return c.json(error('access_invalid', access.error ?? 'Access verification failed'), 402);
    }
    const receiptId = access.receiptId; // pin: narrowing is lost inside traced() closures
    // 2) Anti-replay: a receipt yields exactly one analysis.
    const prior = await db
      .select()
      .from(analysisPayments)
      .where(eq(analysisPayments.receiptId, receiptId))
      .limit(1);
    if (prior.length > 0 && prior[0].status === 'done') {
      return c.json(error('already_used', 'This access was already consumed'), 409);
    }

    // 3) Run — on failure we DON'T consume, so the user can retry the same access.
    const game = await traced('markets.analyze.fetchGameContext', () =>
      ingestor.fetchGameContext(row.eventId, row.sport as Sport, row.league),
    );
    if (!game) {
      return c.json(success({ skip: true, message: 'Could not fetch game data — try again.' }));
    }
    const analysis = await traced('markets.analyze.llm', () =>
      analyst.analyzeGame(game, model.key),
    );
    if (analysis.skip) {
      return c.json(
        success({ skip: true, message: 'The model could not read this game — retry.' }),
      );
    }

    const state = await traced('markets.analyze.marketState', () =>
      marketService.getMarketState(marketObjectId),
    );
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

    // 4) Build a verifiable PROOF BUNDLE — the inputs the model saw + its output +
    //    the Kelly math — then archive it on Walrus: a public, hash-verifiable
    //    summary (no reasoning) + a Seal-encrypted full copy (owner-only).
    const chosenP = probs[rec.outcome] ?? 0; // 0..1
    const fStar =
      rec.impliedProb < 1 ? Math.max(0, (chosenP - rec.impliedProb) / (1 - rec.impliedProb)) : 0;
    const teamInputs = (t: (typeof game)['homeTeam']) => ({
      team: t.displayName,
      score: t.score,
      injuries: t.injuries.map((i) => ({ name: i.athleteName, status: i.status })),
      key_stats: t.keyStats.map((s) => ({ name: s.athleteName, stat: s.statSummary })),
    });
    const publicBundle = {
      schema_version: 1,
      created_at: new Date().toISOString(),
      market: {
        id: marketObjectId,
        home: row.homeTeam,
        away: row.awayTeam,
        league: row.league,
        sport: row.sport,
      },
      model: { id: model.id, label: model.label },
      inputs: {
        status: game.status,
        venue: game.venue?.name ?? null,
        home: teamInputs(game.homeTeam),
        away: teamInputs(game.awayTeam),
        news: game.recentNews.slice(0, 5).map((n) => n.headline),
      },
      ai: {
        model_probs: recommendation.model_probs, // [home, draw, away] %
        implied_prob: recommendation.implied_prob, // %
        confidence_tier: recommendation.confidence_tier,
      },
      kelly: {
        outcome: rec.outcome,
        label: OUTCOME_LABEL[rec.outcome],
        p: Math.round(chosenP * 1000) / 10, // %
        implied: recommendation.implied_prob, // %
        edge: recommendation.edge, // %
        f_star: Math.round(fStar * 1000) / 10, // %
      },
    };
    const { publicBlobId, blobId, contentSha256 } = await traced('markets.analyze.storeProof', () =>
      analysisService.storeProof(receiptId, publicBundle, {
        market: { home: row.homeTeam, away: row.awayTeam, league: row.league },
        model: model.label,
        ...recommendation,
      }),
    );

    // 5) Consume-on-success.
    await db
      .insert(analysisPayments)
      .values({
        receiptId,
        walletAddress,
        modelId: model_id,
        marketId: marketObjectId,
        blobId,
        publicBlobId,
        contentSha256,
        status: 'done',
      })
      .onConflictDoUpdate({
        target: analysisPayments.receiptId,
        set: { status: 'done', blobId, publicBlobId, contentSha256, updatedAt: new Date() },
      });

    return c.json(
      success({
        model: model.label,
        receipt_id: receiptId,
        blob_id: blobId,
        public_blob_id: publicBlobId,
        content_sha256: contentSha256,
        recommendation,
      }),
    );
  });

  // Build the 3-way recommendation + verifiable public proof bundle (shared by the
  // streaming endpoint). Mirrors the synchronous endpoint above.
  function buildSportsAnalysis(
    marketObjectId: string,
    row: MarketRow,
    game: GameSnapshot,
    model: { id: number; label: string },
    analysis: {
      homeWinProbability: number;
      drawProbability: number;
      awayWinProbability: number;
      confidenceTier: string;
      reasoning: string;
    },
    state: Awaited<ReturnType<typeof marketService.getMarketState>>,
  ) {
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
    const chosenP = probs[rec.outcome] ?? 0;
    const fStar =
      rec.impliedProb < 1 ? Math.max(0, (chosenP - rec.impliedProb) / (1 - rec.impliedProb)) : 0;
    const teamInputs = (t: GameSnapshot['homeTeam']) => ({
      team: t.displayName,
      score: t.score,
      injuries: t.injuries.map((i) => ({ name: i.athleteName, status: i.status })),
      key_stats: t.keyStats.map((s) => ({ name: s.athleteName, stat: s.statSummary })),
    });
    const publicBundle = {
      schema_version: 1,
      created_at: new Date().toISOString(),
      market: {
        id: marketObjectId,
        home: row.homeTeam,
        away: row.awayTeam,
        league: row.league,
        sport: row.sport,
      },
      model: { id: model.id, label: model.label },
      inputs: {
        status: game.status,
        venue: game.venue?.name ?? null,
        home: teamInputs(game.homeTeam),
        away: teamInputs(game.awayTeam),
        news: game.recentNews.slice(0, 5).map((n) => n.headline),
      },
      ai: {
        model_probs: recommendation.model_probs,
        implied_prob: recommendation.implied_prob,
        confidence_tier: recommendation.confidence_tier,
      },
      kelly: {
        outcome: rec.outcome,
        label: OUTCOME_LABEL[rec.outcome],
        p: Math.round(chosenP * 1000) / 10,
        implied: recommendation.implied_prob,
        edge: recommendation.edge,
        f_star: Math.round(fStar * 1000) / 10,
      },
    };
    return { recommendation, publicBundle };
  }

  // STREAMING analysis (SSE) — same gate + proof as the sync endpoint, but streams
  // the reasoning token-by-token then the recommendation + proof. Job is claimed +
  // persisted so a dropped connection recovers via the poll endpoint.
  app.post('/api/markets/:id/analyze/stream', zValidator('json', analyzeSchema), async (c) => {
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

    const access = await traced('markets.analyze.verifyAccess', () =>
      analysisService.verifyAccess(access_tx_digest, walletAddress, model_id),
    );
    if (!access.ok || !access.receiptId) {
      return c.json(error('access_invalid', access.error ?? 'Access verification failed'), 402);
    }
    const receiptId = access.receiptId;

    const prior = await db
      .select()
      .from(analysisPayments)
      .where(eq(analysisPayments.receiptId, receiptId))
      .limit(1);
    if (prior.length > 0 && prior[0].status === 'done') {
      return c.json(error('already_used', 'This access was already consumed'), 409);
    }
    if (!analysisJobs.claim(receiptId, walletAddress)) {
      return c.json(error('in_progress', 'Analysis already running for this access'), 409);
    }

    c.header('X-Accel-Buffering', 'no');
    c.header('Cache-Control', 'no-cache, no-transform');

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {});

      await traced('markets.analyze.stream', async () => {
        try {
          await send('status', { stage: 'starting', receipt_id: receiptId });

          const game = await traced('markets.analyze.fetchGameContext', () =>
            ingestor.fetchGameContext(row.eventId, row.sport as Sport, row.league),
          );
          if (!game) {
            analysisJobs.fail(receiptId, 'Could not fetch game data — try again.');
            await send('error', { message: 'Could not fetch game data — try again.' });
            return;
          }

          await send('status', { stage: 'reasoning' });
          const stateP = traced('markets.analyze.marketState', () =>
            marketService.getMarketState(marketObjectId),
          );
          const analysis = await traced('markets.analyze.llm', () =>
            analyst.analyzeGameStream(game, model.key, (delta) =>
              send('reasoning', { text: delta }),
            ),
          );
          if (!analysis) {
            analysisJobs.fail(receiptId, 'The model could not read this game — retry.');
            await send('error', { message: 'The model could not read this game — retry.' });
            return;
          }

          const state = await stateP;
          const { recommendation, publicBundle } = buildSportsAnalysis(
            marketObjectId,
            row,
            game,
            model,
            analysis,
            state,
          );
          analysisJobs.setRecommendation(receiptId, recommendation);
          await send('recommendation', recommendation);

          await send('status', { stage: 'proof' });
          const { publicBlobId, blobId, contentSha256 } = await traced(
            'markets.analyze.storeProof',
            () =>
              analysisService.storeProof(receiptId, publicBundle, {
                market: { home: row.homeTeam, away: row.awayTeam, league: row.league },
                model: model.label,
                ...recommendation,
              }),
          );
          analysisJobs.setProof(receiptId, { blobId, publicBlobId, contentSha256 });
          await db
            .insert(analysisPayments)
            .values({
              receiptId,
              walletAddress,
              modelId: model_id,
              marketId: marketObjectId,
              blobId,
              publicBlobId,
              contentSha256,
              status: 'done',
            })
            .onConflictDoUpdate({
              target: analysisPayments.receiptId,
              set: { status: 'done', blobId, publicBlobId, contentSha256, updatedAt: new Date() },
            });
          await send('proof', {
            public_blob_id: publicBlobId,
            blob_id: blobId,
            content_sha256: contentSha256,
          });
          await send('done', { receipt_id: receiptId });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Analysis failed';
          analysisJobs.fail(receiptId, message);
          await send('error', { message });
        }
      });
    });
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

    const game = await traced('markets.resolveAuto.fetchGameContext', () =>
      ingestor.fetchGameContext(row.eventId, row.sport as Sport, row.league),
    );
    if (!game) return c.json(error('no_game', 'Could not fetch game from ESPN'), 502);
    if (game.status !== 'final') {
      return c.json(error('not_final', `Game is not final (status: ${game.status})`), 409);
    }
    const home = game.homeTeam.score ?? 0;
    const away = game.awayTeam.score ?? 0;
    const winner = home > away ? 0 : home === away ? 1 : 2;

    try {
      const digest = await traced('markets.resolveAuto.resolve', () =>
        marketService.resolveMarket(marketObjectId, winner),
      );
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
    const state = await traced('markets.enrich.marketState', () =>
      marketService.getMarketState(m.marketObjectId),
    );
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
    const rows = await traced('markets.list', () => db.select().from(markets));
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
      const raw = await traced('markets.news', () =>
        ingestor.fetchRelevantNews(row.sport as Sport, row.league, [row.homeTeam, row.awayTeam]),
      );
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
