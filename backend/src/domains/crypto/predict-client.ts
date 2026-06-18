import type { Config } from '@config/config';
import type { Logger } from '@infras/logger/logger';
import { bcs } from '@mysten/sui/bcs';
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';

// DeepBook Predict prices/strikes are 9-dp fixed-point; trade amounts are DUSDC (6 dp).
const PRICE_SCALE = 1e9;
const DUSDC_SCALE = 1e6;
const STRIKE_SCALE = 1_000_000_000n;
const DEAD_SENDER = '0x000000000000000000000000000000000000000000000000000000000000dead';

export interface CryptoMarket {
  oracle_id: string;
  asset: string;
  expiry: number; // ms epoch
  status: string;
  spot: number | null; // USD
  min_strike: number; // USD
  tick_size: number; // USD
}

interface RawOracle {
  oracle_id: string;
  underlying_asset: string;
  expiry: number;
  min_strike: number;
  tick_size: number;
  status: string;
  settlement_price: number | null;
}

interface RawState {
  latest_price?: { spot?: number };
}

export interface CryptoPosition {
  oracle_id: string;
  strike: number; // USD
  is_up: boolean;
  expiry: number; // ms epoch
  quantity: number; // DUSDC payout if it wins
  cost: number; // DUSDC paid
}

interface RawMinted {
  oracle_id: string;
  strike: string | number;
  is_up: boolean;
  expiry: string | number;
  quantity: string | number;
  cost: string | number;
}

export interface PredictClientDeps {
  config: Config;
  logger: Logger;
}

export interface CryptoQuote {
  cost: number;
  payout: number;
  impliedProb: number;
  costBaseUnits: string;
}

export function createPredictClient(deps: PredictClientDeps) {
  const { config, logger } = deps;
  const base = config.deepbookPredict.serverUrl.replace(/\/$/, '');
  const pkg = config.deepbookPredict.packageId;
  const sui = new SuiClient({ url: config.sui.rpcUrl });

  async function fetchJson<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) {
        logger.warn({ path, status: res.status }, 'predict-server fetch failed');
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      logger.warn(
        { path, error: err instanceof Error ? err.message : String(err) },
        'predict-server error',
      );
      return null;
    }
  }

  // Live crypto-price markets: active, not-yet-expired oracles, with current spot.
  async function listMarkets(): Promise<CryptoMarket[]> {
    const oracles = await fetchJson<RawOracle[]>(
      `/predicts/${config.deepbookPredict.predictId}/oracles`,
    );
    if (!oracles) return [];
    const now = Date.now();
    const active = oracles.filter((o) => o.status === 'active' && o.expiry > now);

    const markets = await Promise.all(
      active.map(async (o) => {
        const state = await fetchJson<RawState>(`/oracles/${o.oracle_id}/state`);
        const spot = state?.latest_price?.spot;
        return {
          oracle_id: o.oracle_id,
          asset: o.underlying_asset,
          expiry: o.expiry,
          status: o.status,
          spot: typeof spot === 'number' ? spot / PRICE_SCALE : null,
          min_strike: o.min_strike / PRICE_SCALE,
          tick_size: o.tick_size / PRICE_SCALE,
        } satisfies CryptoMarket;
      }),
    );
    return markets.sort((a, b) => a.expiry - b.expiry); // soonest expiry first
  }

  // Open positions for a manager = minted NET of redeemed, by quantity.
  //
  // The predict-server keeps every minted + redeemed event. Netting by a boolean
  // key (oracle:strike:is_up) is wrong: if a wallet holds several positions on the
  // same oracle/strike/side, or partially redeems, a single redemption would hide
  // the still-open remainder (the "my unredeemed position disappeared" bug). So we
  // subtract redeemed QUANTITY from minted QUANTITY per key and surface what's left.
  async function listPositions(managerId: string): Promise<CryptoPosition[]> {
    const data = await fetchJson<{ minted?: RawMinted[]; redeemed?: RawMinted[] }>(
      `/managers/${managerId}/positions`,
    );
    if (!data?.minted) return [];
    const key = (m: RawMinted) => `${m.oracle_id}:${m.strike}:${m.is_up}`;

    const redeemedQty = new Map<string, number>();
    for (const r of data.redeemed ?? []) {
      redeemedQty.set(key(r), (redeemedQty.get(key(r)) ?? 0) + Number(r.quantity));
    }

    // Aggregate minted by key (base units), keeping the first entry for its metadata.
    const agg = new Map<string, { sample: RawMinted; qty: number; cost: number }>();
    for (const m of data.minted) {
      const k = key(m);
      const a = agg.get(k);
      if (a) {
        a.qty += Number(m.quantity);
        a.cost += Number(m.cost);
      } else {
        agg.set(k, { sample: m, qty: Number(m.quantity), cost: Number(m.cost) });
      }
    }

    const positions: CryptoPosition[] = [];
    for (const [k, a] of agg) {
      const netQty = a.qty - (redeemedQty.get(k) ?? 0);
      if (netQty < 1) continue; // fully redeemed/settled (ignore sub-base-unit dust)
      const costShare = a.qty > 0 ? (a.cost * netQty) / a.qty : a.cost; // proportional
      positions.push({
        oracle_id: a.sample.oracle_id,
        strike: Number(a.sample.strike) / PRICE_SCALE,
        is_up: a.sample.is_up,
        expiry: Number(a.sample.expiry),
        quantity: netQty / DUSDC_SCALE,
        cost: costShare / DUSDC_SCALE,
      });
    }
    return positions.sort((a, b) => a.expiry - b.expiry);
  }

  // Read-only price quote for an Up/Down position via `get_trade_amounts`
  // (devInspect, server-side — keeps the browser off the public RPC).
  async function quote(
    oracleId: string,
    expiry: number,
    strike: number,
    isUp: boolean,
    qty: bigint,
  ): Promise<CryptoQuote | null> {
    try {
      const tx = new Transaction();
      const mk = tx.moveCall({
        target: `${pkg}::market_key::${isUp ? 'up' : 'down'}`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(BigInt(expiry)),
          tx.pure.u64(BigInt(Math.round(strike)) * STRIKE_SCALE),
        ],
      });
      tx.moveCall({
        target: `${pkg}::predict::get_trade_amounts`,
        arguments: [
          tx.object(config.deepbookPredict.predictId),
          tx.object(oracleId),
          mk,
          tx.pure.u64(qty),
          tx.object('0x6'),
        ],
      });
      const r = await sui.devInspectTransactionBlock({ sender: DEAD_SENDER, transactionBlock: tx });
      const rv = r.results?.[1]?.returnValues;
      if (!rv || rv.length < 1) return null;
      const cost = Number(bcs.u64().parse(Uint8Array.from(rv[0][0])));
      return {
        cost: cost / DUSDC_SCALE,
        payout: Number(qty) / DUSDC_SCALE,
        impliedProb: Number(qty) > 0 ? cost / Number(qty) : 0,
        costBaseUnits: String(cost),
      };
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'crypto quote failed',
      );
      return null;
    }
  }

  // Single oracle's current asset/spot/expiry (for AI analysis context).
  async function getOracle(
    oracleId: string,
  ): Promise<{ asset: string; spot: number | null; expiry: number } | null> {
    const state = await fetchJson<{
      oracle?: { underlying_asset?: string; expiry?: number };
      latest_price?: { spot?: number };
    }>(`/oracles/${oracleId}/state`);
    if (!state?.oracle) return null;
    const spot = state.latest_price?.spot;
    return {
      asset: state.oracle.underlying_asset ?? 'BTC',
      spot: typeof spot === 'number' ? spot / PRICE_SCALE : null,
      expiry: Number(state.oracle.expiry),
    };
  }

  // A wallet's shared PredictManager id (via the create event it emitted).
  async function findManager(address: string): Promise<string | null> {
    try {
      const ev = await sui.queryEvents({
        query: { MoveEventType: `${pkg}::predict_manager::PredictManagerCreated` },
        limit: 50,
        order: 'descending',
      });
      for (const e of ev.data) {
        const pj = e.parsedJson as { manager_id?: string; owner?: string } | undefined;
        if (pj?.owner === address && pj.manager_id) return pj.manager_id;
      }
      return null;
    } catch {
      return null;
    }
  }

  return { listMarkets, listPositions, quote, findManager, getOracle };
}

export type PredictClient = ReturnType<typeof createPredictClient>;
