import type { AnalysisJobs } from '@domains/analysis/jobs';
import type { AnalysisService } from '@domains/analysis/service';
import type { CryptoAnalyst } from '@domains/crypto/crypto-analyst';
import type { CryptoNews } from '@domains/crypto/crypto-news';
import type { PredictClient } from '@domains/crypto/predict-client';
import { zValidator } from '@hono/zod-validator';
import { traced } from '@infras/otel/otel';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { error, success } from '../response';

export interface CryptoDeps {
  predictClient: PredictClient;
  cryptoNews: CryptoNews;
  cryptoAnalyst: CryptoAnalyst;
  analysisService: AnalysisService;
  analysisJobs: AnalysisJobs;
}

export function registerCryptoRoutes(app: Hono, deps: CryptoDeps) {
  const pct = (x: number) => Math.round(x * 1000) / 10;
  // Public: live DeepBook Predict crypto-price markets (best-effort; empty if the
  // predict-server is unavailable).
  app.get('/api/crypto/markets', async (c) => {
    try {
      const markets = await traced('crypto.listMarkets', () => deps.predictClient.listMarkets());
      return c.json(success({ markets }));
    } catch {
      return c.json(success({ markets: [] }));
    }
  });

  // Public: open positions for a DeepBook Predict manager (?manager=0x…).
  app.get('/api/crypto/positions', async (c) => {
    const manager = c.req.query('manager');
    if (!manager) return c.json(success({ positions: [] }));
    try {
      const positions = await traced('crypto.listPositions', () =>
        deps.predictClient.listPositions(manager),
      );
      return c.json(success({ positions }));
    } catch {
      return c.json(success({ positions: [] }));
    }
  });

  // Public: price quote for an Up/Down position (server-side devInspect).
  app.get('/api/crypto/quote', async (c) => {
    const oracle = c.req.query('oracle');
    const expiry = Number(c.req.query('expiry'));
    const strike = Number(c.req.query('strike'));
    const qtyRaw = c.req.query('qty');
    const isUp = c.req.query('isUp') !== 'false';
    if (!oracle || !Number.isFinite(expiry) || !Number.isFinite(strike) || !qtyRaw) {
      return c.json(error('bad_request', 'oracle, expiry, strike, qty required'), 400);
    }
    let qty: bigint;
    try {
      qty = BigInt(qtyRaw);
    } catch {
      return c.json(error('bad_request', 'qty must be an integer'), 400);
    }
    const quote = await traced('crypto.quote', () =>
      deps.predictClient.quote(oracle, expiry, strike, isUp, qty),
    );
    return c.json(success({ quote }));
  });

  // Public: a wallet's DeepBook Predict manager id (?address=0x…), or null.
  app.get('/api/crypto/manager', async (c) => {
    const address = c.req.query('address');
    if (!address) return c.json(success({ manager: null }));
    const manager = await traced('crypto.findManager', () =>
      deps.predictClient.findManager(address),
    );
    return c.json(success({ manager }));
  });

  // Public: crypto headlines aggregated from RSS (newest-first). Best-effort.
  app.get('/api/crypto/news', async (c) => {
    const limitRaw = Number(c.req.query('limit'));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 24;
    try {
      const articles = await traced('crypto.news', () => deps.cryptoNews.fetchNews(limit));
      return c.json(success({ articles }));
    } catch {
      return c.json(success({ articles: [] }));
    }
  });

  // Auth: paid/free AI analysis for a crypto market — same on-chain access gate as
  // sports, with the verifiable Walrus proof (public summary + Seal-encrypted full).
  const analyzeSchema = z.object({
    model_id: z.number().int().min(0),
    access_tx_digest: z.string().min(1),
    strike: z.number().positive(),
    is_up: z.boolean(),
  });

  // Shared shapes (inferred from the clients so they never drift).
  type OracleInfo = NonNullable<Awaited<ReturnType<typeof deps.predictClient.getOracle>>>;
  type AnalysisResult = NonNullable<Awaited<ReturnType<typeof deps.cryptoAnalyst.analyze>>>;
  type QuoteResult = Awaited<ReturnType<typeof deps.predictClient.quote>>;
  type ModelInfo = { id: number; key: string; label: string };

  // Model prob (for the chosen side) vs market-implied → edge + Kelly fraction.
  function computeRecommendation(
    oracle: OracleInfo,
    a: AnalysisResult,
    q: QuoteResult,
    strike: number,
    isUp: boolean,
  ) {
    const implied = q?.impliedProb ?? null;
    const pWin = isUp ? a.upProbability : 1 - a.upProbability;
    const edge = implied != null ? pWin - implied : 0;
    const fStar =
      implied != null && implied < 1 ? Math.max(0, (pWin - implied) / (1 - implied)) : 0;
    return {
      asset: oracle.asset,
      side: isUp ? 'Up' : 'Down',
      strike,
      model_prob: pct(pWin),
      implied_prob: implied != null ? pct(implied) : null,
      edge: pct(edge),
      has_edge: edge > 0,
      f_star: pct(fStar),
      confidence_tier: a.confidenceTier,
      reasoning: a.reasoning,
    };
  }

  // Public, hash-verifiable proof bundle (no reasoning — that's Seal-encrypted).
  function buildPublicBundle(
    oracleId: string,
    oracle: OracleInfo,
    a: AnalysisResult,
    recommendation: ReturnType<typeof computeRecommendation>,
    model: ModelInfo,
  ) {
    return {
      schema_version: 1,
      created_at: new Date().toISOString(),
      market: {
        oracle_id: oracleId,
        asset: oracle.asset,
        strike: recommendation.strike,
        expiry: oracle.expiry,
        side: recommendation.side,
      },
      model: { id: model.id, label: model.label },
      inputs: {
        spot: oracle.spot,
        change_24h: a.marketData.change24h,
        change_7d: a.marketData.change7d,
        hours_to_expiry: Math.round(((oracle.expiry - Date.now()) / 3_600_000) * 10) / 10,
      },
      ai: {
        model_prob: recommendation.model_prob,
        implied_prob: recommendation.implied_prob,
        confidence_tier: a.confidenceTier,
      },
      kelly: {
        p: recommendation.model_prob,
        implied: recommendation.implied_prob,
        edge: recommendation.edge,
        f_star: recommendation.f_star,
      },
    };
  }

  // Archive the proof on Walrus, mark the job done, and persist (anti-replay).
  async function storeAndPersist(args: {
    receiptId: string;
    walletAddress: string;
    modelId: number;
    oracleId: string;
    publicBundle: Record<string, unknown>;
    recommendation: ReturnType<typeof computeRecommendation>;
  }) {
    const { publicBlobId, blobId, contentSha256 } = await traced('crypto.analyze.storeProof', () =>
      deps.analysisService.storeProof(args.receiptId, args.publicBundle, {
        ...args.recommendation,
      }),
    );
    deps.analysisJobs.setProof(args.receiptId, { blobId, publicBlobId, contentSha256 });
    await deps.analysisService.recordAnalysis({
      receiptId: args.receiptId,
      walletAddress: args.walletAddress,
      modelId: args.modelId,
      marketId: args.oracleId,
      blobId,
      publicBlobId,
      contentSha256,
    });
    return { publicBlobId, blobId, contentSha256 };
  }

  // The slow work (LLM ~17s + Walrus proof ~11s) runs here, AFTER the request has
  // already returned. Wrapped in one root span so the steps form a single Jaeger
  // trace; state flows back to the client via the job poll endpoint.
  function runAnalysis(args: {
    receiptId: string;
    walletAddress: string;
    oracleId: string;
    strike: number;
    isUp: boolean;
    model: ModelInfo;
    modelId: number;
  }): Promise<void> {
    const { receiptId, walletAddress, oracleId, strike, isUp, model, modelId } = args;
    return traced('crypto.analyze.background', async () => {
      try {
        const oracle = await traced('crypto.analyze.getOracle', () =>
          deps.predictClient.getOracle(oracleId),
        );
        if (!oracle) {
          deps.analysisJobs.fail(receiptId, 'Could not load market — try again.');
          return;
        }

        const [a, q] = await Promise.all([
          traced('crypto.analyze.llm', () =>
            deps.cryptoAnalyst.analyze(
              { asset: oracle.asset, spot: oracle.spot, strike, expiryMs: oracle.expiry },
              model.key,
            ),
          ),
          traced('crypto.analyze.quote', () =>
            deps.predictClient.quote(oracleId, oracle.expiry, strike, isUp, 1_000_000n),
          ),
        ]);
        if (!a) {
          deps.analysisJobs.fail(receiptId, 'The model could not price this — retry.');
          return;
        }

        const recommendation = computeRecommendation(oracle, a, q, strike, isUp);
        deps.analysisJobs.setRecommendation(receiptId, recommendation);
        const publicBundle = buildPublicBundle(oracleId, oracle, a, recommendation, model);
        await storeAndPersist({
          receiptId,
          walletAddress,
          modelId,
          oracleId,
          publicBundle,
          recommendation,
        });
      } catch (err) {
        deps.analysisJobs.fail(receiptId, err instanceof Error ? err.message : 'Analysis failed');
      }
    });
  }

  app.post(
    '/api/crypto/markets/:oracleId/analyze',
    zValidator('json', analyzeSchema),
    async (c) => {
      const walletAddress = c.get('walletAddress') as string | undefined;
      if (!walletAddress) return c.json(error('unauthorized', 'Wallet not authenticated'), 401);

      const oracleId = c.req.param('oracleId');
      const { model_id, access_tx_digest, strike, is_up } = c.req.valid('json');

      const model = await traced('crypto.analyze.model', () =>
        deps.analysisService.getModel(model_id),
      );
      if (!model || !model.active) return c.json(error('bad_model', 'Unknown model'), 400);

      // Verify the on-chain access BEFORE returning (security: reject unpaid/replayed).
      const access = await traced('crypto.analyze.verifyAccess', () =>
        deps.analysisService.verifyAccess(access_tx_digest, walletAddress, model_id),
      );
      if (!access.ok || !access.receiptId) {
        return c.json(error('access_invalid', access.error ?? 'Access verification failed'), 402);
      }
      const receiptId = access.receiptId;

      // Anti-replay: a persisted 'done' row, or an already-running job for this receipt.
      if (await deps.analysisService.isReceiptConsumed(receiptId)) {
        return c.json(error('already_used', 'This access was already consumed'), 409);
      }
      if (!deps.analysisJobs.claim(receiptId, walletAddress)) {
        return c.json(error('in_progress', 'Analysis already running for this access'), 409);
      }

      // Kick the heavy work off in the background and return immediately; the client
      // polls GET /api/analysis/job/:receiptId for the recommendation, then the proof.
      void runAnalysis({
        receiptId,
        walletAddress,
        oracleId,
        strike,
        isUp: is_up,
        model: { id: model.id, key: model.key, label: model.label },
        modelId: model_id,
      });

      return c.json(success({ receipt_id: receiptId, status: 'running' }), 202);
    },
  );

  // Auth: STREAMING analysis (SSE) — same gate + proof as above, but streams the
  // reasoning token-by-token (ChatGPT-style) then the recommendation + proof. The
  // job is still claimed + persisted, so a dropped connection is recoverable via
  // the poll endpoint / getMyAnalyses (the work keeps running if the client leaves).
  app.post(
    '/api/crypto/markets/:oracleId/analyze/stream',
    zValidator('json', analyzeSchema),
    async (c) => {
      const walletAddress = c.get('walletAddress') as string | undefined;
      if (!walletAddress) return c.json(error('unauthorized', 'Wallet not authenticated'), 401);

      const oracleId = c.req.param('oracleId');
      const { model_id, access_tx_digest, strike, is_up } = c.req.valid('json');

      const model = await traced('crypto.analyze.model', () =>
        deps.analysisService.getModel(model_id),
      );
      if (!model || !model.active) return c.json(error('bad_model', 'Unknown model'), 400);

      const access = await traced('crypto.analyze.verifyAccess', () =>
        deps.analysisService.verifyAccess(access_tx_digest, walletAddress, model_id),
      );
      if (!access.ok || !access.receiptId) {
        return c.json(error('access_invalid', access.error ?? 'Access verification failed'), 402);
      }
      const receiptId = access.receiptId;

      if (await deps.analysisService.isReceiptConsumed(receiptId)) {
        return c.json(error('already_used', 'This access was already consumed'), 409);
      }
      if (!deps.analysisJobs.claim(receiptId, walletAddress)) {
        return c.json(error('in_progress', 'Analysis already running for this access'), 409);
      }

      const modelInfo: ModelInfo = { id: model.id, key: model.key, label: model.label };
      // Disable proxy buffering so tokens flush immediately (nginx/caddy).
      c.header('X-Accel-Buffering', 'no');
      c.header('Cache-Control', 'no-cache, no-transform');

      return streamSSE(c, async (stream) => {
        // Writes fail silently if the client disconnected — we keep running so the
        // proof still uploads + persists (recoverable later via the poll endpoint).
        const send = (event: string, data: unknown) =>
          stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {});

        await traced('crypto.analyze.stream', async () => {
          try {
            await send('status', { stage: 'starting', receipt_id: receiptId });

            const oracle = await traced('crypto.analyze.getOracle', () =>
              deps.predictClient.getOracle(oracleId),
            );
            if (!oracle) {
              deps.analysisJobs.fail(receiptId, 'Could not load market — try again.');
              await send('error', { message: 'Could not load market — try again.' });
              return;
            }

            await send('status', { stage: 'reasoning' });
            const quoteP = traced('crypto.analyze.quote', () =>
              deps.predictClient.quote(oracleId, oracle.expiry, strike, is_up, 1_000_000n),
            );
            const a = await traced('crypto.analyze.llm', () =>
              deps.cryptoAnalyst.analyzeStream(
                { asset: oracle.asset, spot: oracle.spot, strike, expiryMs: oracle.expiry },
                modelInfo.key,
                (delta) => send('reasoning', { text: delta }),
              ),
            );
            if (!a) {
              deps.analysisJobs.fail(receiptId, 'The model could not price this — retry.');
              await send('error', { message: 'The model could not price this — retry.' });
              return;
            }

            const q = await quoteP;
            const recommendation = computeRecommendation(oracle, a, q, strike, is_up);
            deps.analysisJobs.setRecommendation(receiptId, recommendation);
            await send('recommendation', recommendation);

            await send('status', { stage: 'proof' });
            const publicBundle = buildPublicBundle(oracleId, oracle, a, recommendation, modelInfo);
            const proof = await storeAndPersist({
              receiptId,
              walletAddress,
              modelId: model_id,
              oracleId,
              publicBundle,
              recommendation,
            });
            await send('proof', {
              public_blob_id: proof.publicBlobId,
              blob_id: proof.blobId,
              content_sha256: proof.contentSha256,
            });
            await send('done', { receipt_id: receiptId });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Analysis failed';
            deps.analysisJobs.fail(receiptId, message);
            await send('error', { message });
          }
        });
      });
    },
  );
}
