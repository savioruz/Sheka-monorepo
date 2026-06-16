import type { Config } from '@config/config';
import type { Database } from '@db/index';
import { models } from '@db/schema/models';
import type { Logger } from '@infras/logger/logger';
import { SealClient } from '@mysten/seal';
import { SuiClient } from '@mysten/sui/client';

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
    await db.insert(models).values(SEED_MODELS).onConflictDoNothing();
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
        await client.waitForTransaction({ digest, timeout: 20_000, pollInterval: 1_000 });
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

  /**
   * Seal-encrypt the analysis result keyed to the receipt id, store the
   * ciphertext on Walrus, and return the blob id. Only the receipt owner can
   * later decrypt it (contract `seal_approve`). Returns null on failure.
   */
  async function encryptAndStore(receiptId: string, payload: unknown): Promise<string | null> {
    try {
      const data = new TextEncoder().encode(JSON.stringify(payload));
      const { encryptedObject } = await sealClient.encrypt({
        threshold: 1,
        packageId: config.analysis.packageId,
        id: receiptId,
        data,
      });
      const publisher = config.walrus.publisherUrl.replace(/\/$/, '');
      const res = await fetch(`${publisher}/v1/blobs?epochs=${config.walrus.epochs}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: encryptedObject,
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`Walrus publisher ${res.status}`);
      const out = (await res.json()) as {
        newlyCreated?: { blobObject?: { blobId?: string } };
        alreadyCertified?: { blobId?: string };
      };
      const blobId = out?.newlyCreated?.blobObject?.blobId ?? out?.alreadyCertified?.blobId ?? null;
      logger.info({ receiptId, blobId }, 'Seal-encrypted analysis stored on Walrus');
      return blobId;
    } catch (err) {
      logger.warn(
        { receiptId, error: err instanceof Error ? err.message : String(err) },
        'encryptAndStore failed',
      );
      return null;
    }
  }

  return { seedModels, verifyAccess, freeUsed, encryptAndStore };
}

export type AnalysisService = ReturnType<typeof createAnalysisService>;
