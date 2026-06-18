import { Transaction } from '@mysten/sui/transactions';
import { request, unwrap } from '$lib/api';

const PKG =
	import.meta.env.VITE_DEEPBOOK_PREDICT_PACKAGE_ID ??
	'0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_ID =
	import.meta.env.VITE_DEEPBOOK_PREDICT_OBJECT_ID ??
	'0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const DUSDC_TYPE =
	import.meta.env.VITE_DUSDC_TYPE ??
	'0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
const CLOCK = '0x6';

// Strike (price feed) is 9-dp fixed-point; trade amounts (cost/qty) are DUSDC (6 dp).
export const STRIKE_SCALE = 1_000_000_000n;
export const DUSDC_SCALE = 1_000_000;

export interface MarketKeyInput {
	oracleId: string;
	expiry: number; // ms epoch (on-chain u64 as-is)
	strike: number; // USD (scaled by 1e9 on-chain)
	isUp: boolean;
}

// Build the MarketKey via the on-chain constructor (up/down), returning the arg.
function addMarketKey(tx: Transaction, k: MarketKeyInput) {
	const strikeScaled = BigInt(Math.round(k.strike)) * STRIKE_SCALE;
	return tx.moveCall({
		target: `${PKG}::market_key::${k.isUp ? 'up' : 'down'}`,
		arguments: [tx.pure.id(k.oracleId), tx.pure.u64(k.expiry), tx.pure.u64(strikeScaled)]
	});
}

/** The wallet's DeepBook Predict manager id (resolved server-side to avoid the public RPC). */
export async function findManager(address: string): Promise<string | null> {
	try {
		const res = await request<{ data: { manager: string | null } }>(
			`/api/crypto/manager?address=${encodeURIComponent(address)}`
		);
		return unwrap(res).manager;
	} catch {
		return null;
	}
}

/** First-time only: create the shared PredictManager (its own tx; returns its id in effects). */
export function buildCreateManagerTransaction(): Transaction {
	const tx = new Transaction();
	tx.setGasBudget(50_000_000);
	tx.moveCall({ target: `${PKG}::predict::create_manager` });
	return tx;
}

/**
 * Read-only quote (cost + implied probability) for buying `qty` (DUSDC base units,
 * = max payout if it wins). Resolved server-side (`/api/crypto/quote`) so the
 * browser never hits the public RPC.
 */
export async function quoteTrade(
	key: MarketKeyInput,
	qty: bigint
): Promise<{ costBaseUnits: bigint; cost: number; payout: number; impliedProb: number } | null> {
	try {
		const params = new URLSearchParams({
			oracle: key.oracleId,
			expiry: String(key.expiry),
			strike: String(Math.round(key.strike)),
			isUp: String(key.isUp),
			qty: qty.toString()
		});
		const res = await request<{
			data: {
				// The backend serializer returns snake_case keys.
				quote: {
					cost: number;
					payout: number;
					implied_prob: number;
					cost_base_units: string;
				} | null;
			};
		}>(`/api/crypto/quote?${params.toString()}`);
		const q = unwrap(res).quote;
		return q
			? {
					cost: q.cost,
					payout: q.payout,
					impliedProb: q.implied_prob,
					costBaseUnits: BigInt(q.cost_base_units)
				}
			: null;
	} catch {
		return null;
	}
}

/**
 * Buy `qty` of an Up/Down position. One PTB: deposit `depositBaseUnits` DUSDC into
 * the (existing, shared) manager, then mint. Requires a manager — create it first
 * with `buildCreateManagerTransaction` if `findManager` returns null.
 */
export function buildBuyTransaction(inputs: {
	manager: string;
	key: MarketKeyInput;
	qty: bigint;
	depositBaseUnits: bigint; // DUSDC (6 dp) to deposit to cover the cost
	dusdcCoinObjectIds: string[];
}): Transaction {
	const tx = new Transaction();
	tx.setGasBudget(100_000_000);

	const coins = inputs.dusdcCoinObjectIds.map((id) => tx.object(id));
	const [primary, ...rest] = coins;
	if (rest.length > 0) tx.mergeCoins(primary, rest);
	const [deposit] = tx.splitCoins(primary, [tx.pure.u64(inputs.depositBaseUnits)]);
	tx.moveCall({
		target: `${PKG}::predict_manager::deposit`,
		typeArguments: [DUSDC_TYPE],
		arguments: [tx.object(inputs.manager), deposit]
	});

	const mk = addMarketKey(tx, inputs.key);
	tx.moveCall({
		target: `${PKG}::predict::mint`,
		typeArguments: [DUSDC_TYPE],
		arguments: [
			tx.object(PREDICT_ID),
			tx.object(inputs.manager),
			tx.object(inputs.key.oracleId),
			mk,
			tx.pure.u64(inputs.qty),
			tx.object(CLOCK)
		]
	});
	return tx;
}

/** Redeem a settled position back into the manager's balance. */
export function buildRedeemTransaction(inputs: {
	manager: string;
	key: MarketKeyInput;
	qty: bigint;
}): Transaction {
	const tx = new Transaction();
	tx.setGasBudget(100_000_000);
	const mk = addMarketKey(tx, inputs.key);
	tx.moveCall({
		target: `${PKG}::predict::redeem`,
		typeArguments: [DUSDC_TYPE],
		arguments: [
			tx.object(PREDICT_ID),
			tx.object(inputs.manager),
			tx.object(inputs.key.oracleId),
			mk,
			tx.pure.u64(inputs.qty),
			tx.object(CLOCK)
		]
	});
	return tx;
}
