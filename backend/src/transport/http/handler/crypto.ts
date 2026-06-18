import type { Database } from '@db/index';
import { analysisPayments } from '@db/schema/analysis-payments';
import { models } from '@db/schema/models';
import type { AnalysisService } from '@domains/analysis/service';
import type { CryptoAnalyst } from '@domains/crypto/crypto-analyst';
import type { CryptoNews } from '@domains/crypto/crypto-news';
import type { PredictClient } from '@domains/crypto/predict-client';
import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { z } from 'zod';
import { error, success } from '../response';

export interface CryptoDeps {
  predictClient: PredictClient;
  cryptoNews: CryptoNews;
  cryptoAnalyst: CryptoAnalyst;
  analysisService: AnalysisService;
  db: Database;
}

export function registerCryptoRoutes(app: Hono, deps: CryptoDeps) {
  const pct = (x: number) => Math.round(x * 1000) / 10;
  // Public: live DeepBook Predict crypto-price markets (best-effort; empty if the
  // predict-server is unavailable).
  app.get('/api/crypto/markets', async (c) => {
    try {
      const markets = await deps.predictClient.listMarkets();
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
      const positions = await deps.predictClient.listPositions(manager);
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
    const quote = await deps.predictClient.quote(oracle, expiry, strike, isUp, qty);
    return c.json(success({ quote }));
  });

  // Public: a wallet's DeepBook Predict manager id (?address=0x…), or null.
  app.get('/api/crypto/manager', async (c) => {
    const address = c.req.query('address');
    if (!address) return c.json(success({ manager: null }));
    const manager = await deps.predictClient.findManager(address);
    return c.json(success({ manager }));
  });

  // Public: crypto headlines aggregated from RSS (newest-first). Best-effort.
  app.get('/api/crypto/news', async (c) => {
    const limitRaw = Number(c.req.query('limit'));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 24;
    try {
      const articles = await deps.cryptoNews.fetchNews(limit);
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

  app.post(
    '/api/crypto/markets/:oracleId/analyze',
    zValidator('json', analyzeSchema),
    async (c) => {
      const walletAddress = c.get('walletAddress') as string | undefined;
      if (!walletAddress) return c.json(error('unauthorized', 'Wallet not authenticated'), 401);

      const oracleId = c.req.param('oracleId');
      const { model_id, access_tx_digest, strike, is_up } = c.req.valid('json');

      const [model] = await deps.db.select().from(models).where(eq(models.id, model_id)).limit(1);
      if (!model || !model.active) return c.json(error('bad_model', 'Unknown model'), 400);

      const access = await deps.analysisService.verifyAccess(
        access_tx_digest,
        walletAddress,
        model_id,
      );
      if (!access.ok || !access.receiptId) {
        return c.json(error('access_invalid', access.error ?? 'Access verification failed'), 402);
      }
      const prior = await deps.db
        .select()
        .from(analysisPayments)
        .where(eq(analysisPayments.receiptId, access.receiptId))
        .limit(1);
      if (prior.length > 0 && prior[0].status === 'done') {
        return c.json(error('already_used', 'This access was already consumed'), 409);
      }

      const oracle = await deps.predictClient.getOracle(oracleId);
      if (!oracle)
        return c.json(success({ skip: true, message: 'Could not load market — try again.' }));

      const a = await deps.cryptoAnalyst.analyze(
        { asset: oracle.asset, spot: oracle.spot, strike, expiryMs: oracle.expiry },
        model.key,
      );
      if (!a)
        return c.json(success({ skip: true, message: 'The model could not price this — retry.' }));

      const q = await deps.predictClient.quote(oracleId, oracle.expiry, strike, is_up, 1_000_000n);
      const implied = q?.impliedProb ?? null;
      const pWin = is_up ? a.upProbability : 1 - a.upProbability;
      const edge = implied != null ? pWin - implied : 0;
      const fStar =
        implied != null && implied < 1 ? Math.max(0, (pWin - implied) / (1 - implied)) : 0;

      const recommendation = {
        asset: oracle.asset,
        side: is_up ? 'Up' : 'Down',
        strike,
        model_prob: pct(pWin),
        implied_prob: implied != null ? pct(implied) : null,
        edge: pct(edge),
        has_edge: edge > 0,
        f_star: pct(fStar),
        confidence_tier: a.confidenceTier,
        reasoning: a.reasoning,
      };

      const publicBundle = {
        schema_version: 1,
        created_at: new Date().toISOString(),
        market: {
          oracle_id: oracleId,
          asset: oracle.asset,
          strike,
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
      const { publicBlobId, blobId, contentSha256 } = await deps.analysisService.storeProof(
        access.receiptId,
        publicBundle,
        { ...recommendation },
      );

      await deps.db
        .insert(analysisPayments)
        .values({
          receiptId: access.receiptId,
          walletAddress,
          modelId: model_id,
          marketId: oracleId,
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
          receipt_id: access.receiptId,
          blob_id: blobId,
          public_blob_id: publicBlobId,
          content_sha256: contentSha256,
          recommendation,
        }),
      );
    },
  );
}
