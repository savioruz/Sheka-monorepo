import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { Config } from '@config/config';
import type { Database } from '@db/index';
import type { Logger } from '@infras/logger/logger';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { createMarketRepository } from './repository';

export interface MarketServiceDeps {
  config: Config;
  logger: Logger;
  db: Database;
}

export interface MarketState {
  pools: number[]; // [home, draw, away] base units
  total: number;
  status: number; // 0 open, 1 resolved
  winner: number; // 0..2 or 255
}

export interface CreatedMarket {
  marketObjectId: string;
  digest: string;
}

// Load the admin Ed25519 keypair (owner of AdminCap) from the local Sui keystore.
function loadAdminKeypair(adminAddress: string): Ed25519Keypair {
  const path = `${homedir()}/.sui/sui_config/sui.keystore`;
  const keystore = JSON.parse(readFileSync(path, 'utf8')) as string[];
  for (const b64 of keystore) {
    const raw = Buffer.from(b64, 'base64');
    if (raw[0] !== 0x00) continue; // ed25519 only
    const kp = Ed25519Keypair.fromSecretKey(new Uint8Array(raw.subarray(1)));
    if (!adminAddress || kp.toSuiAddress() === adminAddress) return kp;
  }
  throw new Error('Sheka market admin keypair not found in Sui keystore');
}

export function createMarketService(deps: MarketServiceDeps) {
  const { config, logger, db } = deps;
  const repo = createMarketRepository({ db });
  const client = new SuiClient({ url: config.sui.rpcUrl });
  const pkg = config.market.packageId;
  const adminCap = config.market.adminCapId;
  const dusdc = config.dusdc.type;

  let cachedKeypair: Ed25519Keypair | null = null;
  function admin(): Ed25519Keypair {
    if (!cachedKeypair) cachedKeypair = loadAdminKeypair(config.market.adminAddress);
    return cachedKeypair;
  }

  async function createMarket(eventId: string, home: string, away: string): Promise<CreatedMarket> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${pkg}::market::create_market`,
      typeArguments: [dusdc],
      arguments: [
        tx.object(adminCap),
        tx.pure.string(eventId),
        tx.pure.string(home),
        tx.pure.string(away),
      ],
    });
    const res = await client.signAndExecuteTransaction({
      signer: admin(),
      transaction: tx,
      options: { showObjectChanges: true, showEffects: true },
    });
    await client.waitForTransaction({ digest: res.digest });
    const created = res.objectChanges?.find(
      (c) => c.type === 'created' && c.objectType.includes('::market::Market<'),
    ) as { objectId: string } | undefined;
    if (!created) throw new Error('Market object not found in tx effects');
    logger.info({ marketObjectId: created.objectId, eventId }, 'Market created');
    return { marketObjectId: created.objectId, digest: res.digest };
  }

  async function resolveMarket(marketObjectId: string, winner: number): Promise<string> {
    const tx = new Transaction();
    tx.moveCall({
      target: `${pkg}::market::resolve`,
      typeArguments: [dusdc],
      arguments: [tx.object(adminCap), tx.object(marketObjectId), tx.pure.u8(winner)],
    });
    const res = await client.signAndExecuteTransaction({
      signer: admin(),
      transaction: tx,
      options: { showEffects: true },
    });
    await client.waitForTransaction({ digest: res.digest });
    logger.info({ marketObjectId, winner }, 'Market resolved');
    return res.digest;
  }

  async function getMarketState(marketObjectId: string): Promise<MarketState | null> {
    try {
      const obj = await client.getObject({
        id: marketObjectId,
        options: { showContent: true },
      });
      const content = obj.data?.content;
      if (!content || content.dataType !== 'moveObject') return null;
      const fields = content.fields as {
        pools: string[];
        total: string;
        status: number | string;
        winner: number | string;
      };
      return {
        pools: (fields.pools ?? []).map((p) => Number(p)),
        total: Number(fields.total),
        status: Number(fields.status),
        winner: Number(fields.winner),
      };
    } catch (err) {
      logger.warn(
        { marketObjectId, error: err instanceof Error ? err.message : String(err) },
        'getMarketState failed',
      );
      return null;
    }
  }

  // --- Local markets-cache reads/writes (delegated to the repository) ---

  /** One market DB row by its on-chain object id, or undefined. */
  function getMarketRow(marketObjectId: string) {
    return repo.getByObjectId(marketObjectId);
  }

  /** All market DB rows. */
  function listMarketRows() {
    return repo.listAll();
  }

  /** Mark a market resolved (winner + settle tx digest). */
  function markResolved(
    marketObjectId: string,
    winner: number,
    resolveTxDigest: string,
  ): Promise<void> {
    return repo.markResolved(marketObjectId, winner, resolveTxDigest);
  }

  /** Mirror a terminal auto/manual void to the local cache (status='resolved'). */
  function markVoided(
    marketObjectId: string,
    winner: number,
    resolveTxDigest: string,
  ): Promise<void> {
    return repo.markVoided(marketObjectId, winner, resolveTxDigest);
  }

  return {
    createMarket,
    resolveMarket,
    getMarketState,
    getMarketRow,
    listMarketRows,
    markResolved,
    markVoided,
  };
}

export type MarketService = ReturnType<typeof createMarketService>;
