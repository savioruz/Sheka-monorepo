import { createHash } from 'node:crypto';
import type { Config } from '@config/config';
import type { Database } from '@db/index';
import type { Logger } from '@infras/logger/logger';
import { traced } from '@infras/otel/otel';
import { SealClient } from '@mysten/seal';
import { SuiClient } from '@mysten/sui/client';
import { createAnalysisRepository } from './repository';

// Stable JSON (recursively sorted keys) so a hash is reproducible by any verifier.
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

// Testnet Seal key server (independent, open mode).
const SEAL_KEY_SERVERS = ['0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75'];

export interface AnalysisServiceDeps {
  config: Config;
  logger: Logger;
  db: Database;
}

export interface AccessResult {
  ok: boolean;
  receiptId?: string;
  error?: string;
}

const SEED_MODELS = [
  // Auto: 3 free runs (on-chain quota), then 0.05 SUI per run.
  { id: 0, key: 'minimax/minimax-m3', label: 'Auto', priceMist: 50_000_000, free: true, sort: 0 },
  {
    id: 1,
    key: 'anthropic/claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    priceMist: 100_000_000,
    free: false,
    sort: 1,
  },
  {
    id: 2,
    key: 'anthropic/claude-opus-4.8',
    label: 'Claude Opus 4.8',
    priceMist: 250_000_000,
    free: false,
    sort: 2,
  },
  { id: 3, key: 'openai/gpt-5.4', label: 'GPT-5.4', priceMist: 150_000_000, free: false, sort: 3 },
];

export function createAnalysisService(deps: AnalysisServiceDeps) {
  const { config, logger, db } = deps;
  const repo = createAnalysisRepository({ db });
  const client = new SuiClient({ url: config.sui.rpcUrl });
  const sealClient = new SealClient({
    suiClient: client,
    serverConfigs: SEAL_KEY_SERVERS.map((objectId) => ({ objectId, weight: 1 })),
    verifyKeyServers: false,
  });
  const purchasedType = `${config.analysis.packageId}::analysis::AnalysisPurchased`;
  const freeType = `${config.analysis.packageId}::analysis::FreeClaimed`;

  // Idempotently seed the model catalog (ids match the on-chain price registry).
  async function seedModels(): Promise<void> {
    await repo.insertSeedModels(SEED_MODELS);
  }

  /**
   * Verify the access tx: it must be a successful call to our analysis package
   * (purchase or claim_free), the receipt's buyer must equal the session wallet,
   * and the model must match. Returns the on-chain receipt id (anti-replay key).
   */
  async function verifyAccess(
    digest: string,
    walletAddress: string,
    modelId: number,
  ): Promise<AccessResult> {
    try {
      // The tx was just executed client-side; our RPC node may not have indexed
      // it yet. Wait for propagation before reading it.
      try {
        // Poll faster than the 1s default so we return as soon as our node indexes
        // the just-submitted access tx (this otherwise dominates analyze latency).
        await client.waitForTransaction({ digest, timeout: 20_000, pollInterval: 250 });
      } catch {
        /* fall through — getTransactionBlock will surface a clear error if truly missing */
      }
      const tx = await client.getTransactionBlock({
        digest,
        options: { showEffects: true, showEvents: true },
      });
      const status = tx.effects?.status?.status;
      if (status !== 'success') return { ok: false, error: 'Access tx did not succeed' };

      for (const ev of tx.events ?? []) {
        const json = ev.parsedJson as
          | { buyer?: string; model_id?: string | number; receipt_id?: string }
          | undefined;
        if (!json) continue;
        const buyer = (json.buyer ?? '').toLowerCase();
        if (buyer !== walletAddress.toLowerCase()) continue;

        if (ev.type === purchasedType && Number(json.model_id) === modelId) {
          return { ok: true, receiptId: json.receipt_id };
        }
        if (ev.type === freeType && modelId === config.analysis.autoModelId) {
          return { ok: true, receiptId: json.receipt_id };
        }
      }
      return { ok: false, error: 'No matching purchase/claim event for this wallet & model' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Free runs already used by a wallet (on-chain Quota). Display-only; the
   * contract enforces the cap regardless. */
  async function freeUsed(walletAddress: string): Promise<number> {
    try {
      const quota = await client.getObject({
        id: config.analysis.quotaId,
        options: { showContent: true },
      });
      const content = quota.data?.content;
      if (!content || content.dataType !== 'moveObject') return 0;
      const tableId = (content.fields as { used: { fields: { id: { id: string } } } }).used.fields
        .id.id;
      const entry = await client.getDynamicFieldObject({
        parentId: tableId,
        name: { type: 'address', value: walletAddress },
      });
      const ec = entry.data?.content;
      if (!ec || ec.dataType !== 'moveObject') return 0;
      return Number((ec.fields as { value: string | number }).value);
    } catch (err) {
      logger.warn(
        { walletAddress, error: err instanceof Error ? err.message : String(err) },
        'freeUsed read failed',
      );
      return 0;
    }
  }

  // PUT raw bytes to the Walrus publisher; returns the blob id (or null).
  async function putBlob(body: Uint8Array): Promise<string | null> {
    const publisher = config.walrus.publisherUrl.replace(/\/$/, '');
    const res = await fetch(`${publisher}/v1/blobs?epochs=${config.walrus.epochs}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Blob([new Uint8Array(body)]),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`Walrus publisher ${res.status}`);
    const out = (await res.json()) as {
      newlyCreated?: { blobObject?: { blobId?: string } };
      alreadyCertified?: { blobId?: string };
    };
    return out?.newlyCreated?.blobObject?.blobId ?? out?.alreadyCertified?.blobId ?? null;
  }

  /**
   * Archive an analysis as a verifiable proof on Walrus:
   * - a PUBLIC plaintext blob = `publicBundle` + its own `content_sha256`
   *   (anyone can fetch from the aggregator and recompute the hash to verify integrity),
   * - a PRIVATE Seal-encrypted blob = `privatePayload` (full result incl. reasoning),
   *   decryptable only by the receipt owner via the contract `seal_approve`.
   * Returns the two blob ids + the content hash (null fields on failure).
   */
  async function storeProof(
    receiptId: string,
    publicBundle: Record<string, unknown>,
    privatePayload: unknown,
  ): Promise<{ publicBlobId: string | null; blobId: string | null; contentSha256: string | null }> {
    try {
      const contentSha256 = sha256Hex(canonicalize(publicBundle));

      // The two Walrus uploads are independent — the public plaintext blob and the
      // Seal-encrypt-then-upload of the private blob. Run them concurrently so the
      // (slow) testnet publisher latency overlaps instead of stacking.
      const [publicBlobId, blobId] = await Promise.all([
        traced('storeProof.putPublic', () =>
          putBlob(
            new TextEncoder().encode(
              JSON.stringify({ ...publicBundle, content_sha256: contentSha256 }),
            ),
          ),
        ),
        traced('storeProof.encryptPutPrivate', async () => {
          const { encryptedObject } = await sealClient.encrypt({
            threshold: 1,
            packageId: config.analysis.packageId,
            id: receiptId,
            data: new TextEncoder().encode(JSON.stringify(privatePayload)),
          });
          return putBlob(encryptedObject);
        }),
      ]);

      logger.info(
        { receiptId, publicBlobId, blobId, contentSha256 },
        'analysis proof stored on Walrus',
      );
      return { publicBlobId, blobId, contentSha256 };
    } catch (err) {
      logger.warn(
        { receiptId, error: err instanceof Error ? err.message : String(err) },
        'storeProof failed',
      );
      return { publicBlobId: null, blobId: null, contentSha256: null };
    }
  }

  // --- DB-backed reads/writes (delegated to the repository) ---

  /** Active model catalog (for the analyze picker), ordered by sort. */
  function listActiveModels() {
    return repo.listActiveModels();
  }

  /** One model row by id, or undefined. */
  function getModel(modelId: number) {
    return repo.getModelById(modelId);
  }

  /** True if this receipt already yielded a completed analysis (anti-replay). */
  async function isReceiptConsumed(receiptId: string): Promise<boolean> {
    const prior = await repo.getPaymentByReceipt(receiptId);
    return prior?.status === 'done';
  }

  /** Analyses a wallet owns (re-view/decrypt across sessions); Seal/Walrus refs. */
  async function ownedAnalyses(walletAddress: string) {
    const rows = await repo.listOwnedPayments(walletAddress);
    return rows
      .filter((r) => r.marketId && r.blobId)
      .map((r) => ({
        market_id: r.marketId,
        receipt_id: r.receiptId,
        blob_id: r.blobId,
        public_blob_id: r.publicBlobId,
        content_sha256: r.contentSha256,
        model_id: r.modelId,
        created_at: r.createdAt,
      }));
  }

  /** Consume-on-success: upsert the analysis payment row to 'done' with blob refs. */
  function recordAnalysis(args: Parameters<typeof repo.upsertPaymentDone>[0]): Promise<void> {
    return repo.upsertPaymentDone(args);
  }

  // Public verifiable AI-decision ledger: every analysis's hash-verifiable Walrus
  // proof (newest-first). Public fields only — never the Seal blob id or wallet.
  async function proofFeed(limit: number) {
    const rows = await repo.listProofFeed(limit);
    return rows.map((r) => ({
      market_id: r.marketId,
      model_id: r.modelId,
      model_label: r.modelLabel,
      public_blob_id: r.publicBlobId,
      content_sha256: r.contentSha256,
      created_at: r.createdAt,
    }));
  }

  return {
    seedModels,
    verifyAccess,
    freeUsed,
    storeProof,
    proofFeed,
    listActiveModels,
    getModel,
    isReceiptConsumed,
    ownedAnalyses,
    recordAnalysis,
  };
}

export type AnalysisService = ReturnType<typeof createAnalysisService>;
