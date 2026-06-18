import type { Config } from '@config/config';
import type { Database } from '@db/index';
import { analysisPayments } from '@db/schema/analysis-payments';
import { models } from '@db/schema/models';
import type { AnalysisService } from '@domains/analysis/service';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { error, success } from '../response';

export interface AnalysisDeps {
  config: Config;
  db: Database;
  analysisService: AnalysisService;
}

export function registerAnalysisRoutes(app: Hono, deps: AnalysisDeps) {
  const { config, db, analysisService } = deps;

  // Public: the model catalog for the analyze dropdown.
  app.get('/api/models', async (c) => {
    const rows = await db
      .select()
      .from(models)
      .where(eq(models.active, true))
      .orderBy(asc(models.sort));
    return c.json(
      success({
        models: rows.map((m) => ({
          id: m.id,
          // Don't leak which underlying model "Auto" maps to; paid models keep
          // their real key (a selling point).
          key: m.id === config.analysis.autoModelId ? 'auto' : m.key,
          label: m.label,
          price_mist: m.priceMist,
          price_sui: m.priceMist / 1_000_000_000,
          free: m.free,
        })),
      }),
    );
  });

  // Auth: the caller's on-chain free quota (display).
  app.get('/api/analysis/quota', async (c) => {
    const walletAddress = c.get('walletAddress') as string | undefined;
    if (!walletAddress) return c.json(error('unauthorized', 'Wallet not authenticated'), 401);
    const used = await analysisService.freeUsed(walletAddress);
    const limit = config.analysis.freeLimit;
    return c.json(
      success({ free_used: used, free_limit: limit, free_remaining: Math.max(0, limit - used) }),
    );
  });

  // Auth: analyses this wallet already owns, so they can re-view (decrypt) them
  // across sessions. Returns the Seal/Walrus refs; the plaintext stays owner-only.
  app.get('/api/analysis/mine', async (c) => {
    const walletAddress = c.get('walletAddress') as string | undefined;
    if (!walletAddress) return c.json(error('unauthorized', 'Wallet not authenticated'), 401);
    const rows = await db
      .select()
      .from(analysisPayments)
      .where(
        and(eq(analysisPayments.walletAddress, walletAddress), eq(analysisPayments.status, 'done')),
      )
      .orderBy(desc(analysisPayments.createdAt));
    return c.json(
      success({
        analyses: rows
          .filter((r) => r.marketId && r.blobId)
          .map((r) => ({
            market_id: r.marketId,
            receipt_id: r.receiptId,
            blob_id: r.blobId,
            public_blob_id: r.publicBlobId,
            content_sha256: r.contentSha256,
            model_id: r.modelId,
          })),
      }),
    );
  });
}
