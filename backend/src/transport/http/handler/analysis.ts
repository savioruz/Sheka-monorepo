import type { Config } from '@config/config';
import type { AnalysisJobs } from '@domains/analysis/jobs';
import type { AnalysisService } from '@domains/analysis/service';
import { traced } from '@infras/otel/otel';
import type { Hono } from 'hono';
import { error, success } from '../response';

export interface AnalysisDeps {
  config: Config;
  analysisService: AnalysisService;
  analysisJobs: AnalysisJobs;
}

export function registerAnalysisRoutes(app: Hono, deps: AnalysisDeps) {
  const { config, analysisService, analysisJobs } = deps;

  // Public: the model catalog for the analyze dropdown.
  app.get('/api/models', async (c) => {
    const rows = await analysisService.listActiveModels();
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

  // Public: the verifiable AI-decision ledger — every analysis's hash-verifiable
  // Walrus public proof, newest-first. Public fields ONLY: never the Seal blob id
  // or the full wallet. This is Sheka's auditable, accumulating "AI memory" surface.
  app.get('/api/analysis/feed', async (c) => {
    const limRaw = Number(c.req.query('limit'));
    const limit = Number.isFinite(limRaw) && limRaw > 0 ? Math.min(limRaw, 100) : 50;
    const analyses = await analysisService.proofFeed(limit);
    return c.json(success({ analyses }));
  });

  // Auth: the caller's on-chain free quota (display).
  app.get('/api/analysis/quota', async (c) => {
    const walletAddress = c.get('walletAddress') as string | undefined;
    if (!walletAddress) return c.json(error('unauthorized', 'Wallet not authenticated'), 401);
    const used = await traced('quota.freeUsed', () => analysisService.freeUsed(walletAddress));
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
    const analyses = await analysisService.ownedAnalyses(walletAddress);
    return c.json(success({ analyses }));
  });

  // Auth: poll a background analysis job by its receipt id (job+poll flow). Returns
  // the recommendation as soon as it's ready, then the Walrus proof refs when stored.
  app.get('/api/analysis/job/:receiptId', async (c) => {
    const walletAddress = c.get('walletAddress') as string | undefined;
    if (!walletAddress) return c.json(error('unauthorized', 'Wallet not authenticated'), 401);
    const receiptId = c.req.param('receiptId');
    const job = analysisJobs.get(receiptId);
    if (!job) return c.json(error('not_found', 'No such analysis job'), 404);
    if (job.walletAddress !== walletAddress) {
      return c.json(error('forbidden', 'Not your analysis'), 403);
    }
    return c.json(
      success({
        status: job.status,
        recommendation: job.recommendation ?? null,
        public_blob_id: job.publicBlobId ?? null,
        blob_id: job.blobId ?? null,
        content_sha256: job.contentSha256 ?? null,
        message: job.message ?? null,
      }),
    );
  });
}
