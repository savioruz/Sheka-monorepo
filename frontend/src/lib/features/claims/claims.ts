import type { SuiClient } from '@mysten/sui/client';
import { writable } from 'svelte/store';
import {
	fetchUserPositions,
	getMarkets,
	positionValue,
	OUTCOME_LABEL
} from '$lib/features/markets';
import { findManager, getCryptoPositions } from '$lib/features/crypto';

const DUSDC_DECIMALS = 1_000_000; // 6 dp

/**
 * A winning position the connected wallet can claim. Carries enough to both
 * render a card and build the on-chain claim/redeem transaction.
 */
export type ClaimableItem =
	| {
			kind: 'sports';
			key: string; // position object id (unique)
			label: string; // "Home vs Away"
			pick: string; // Home | Draw | Away
			payout: number; // DUSDC (human)
			marketObjectId: string;
			positionId: string;
	  }
	| {
			kind: 'crypto';
			key: string; // oracle:strike:side (unique per open position)
			label: string; // "BTC ≥ $67,305 · Up"
			pick: string; // Up | Down
			payout: number; // DUSDC (human) — full payout on a win
			manager: string;
			oracleId: string;
			expiry: number;
			strike: number;
			isUp: boolean;
			quantity: number; // DUSDC (human)
	  };

/**
 * Every winning, still-unclaimed position across both products:
 * - sports: an on-chain `Position` on a resolved market whose `winner === outcome`,
 * - crypto: a settled DeepBook Predict position whose side beat the strike.
 * Best-effort per product — a failure in one leaves the other intact.
 */
export async function loadClaimable(
	walletAddress: string,
	suiClient: SuiClient
): Promise<ClaimableItem[]> {
	const items: ClaimableItem[] = [];

	const [positions, manager] = await Promise.all([
		fetchUserPositions(suiClient, walletAddress).catch(() => []),
		findManager(walletAddress).catch(() => null)
	]);

	// Sports: resolved markets where the held outcome is the winner.
	if (positions.length > 0) {
		try {
			const { markets } = await getMarkets();
			const byId = new Map(markets.map((m) => [m.market_object_id, m]));
			for (const p of positions) {
				const m = byId.get(p.marketId);
				if (!m || m.status !== 'resolved' || m.winner === null) continue;
				if (m.winner !== p.outcome) continue; // losing position
				const { payout } = positionValue(p.amount, p.outcome, m.pools, m.total);
				items.push({
					kind: 'sports',
					key: p.id,
					label: `${m.home} vs ${m.away}`,
					pick: OUTCOME_LABEL[p.outcome] ?? `#${p.outcome}`,
					payout: payout / DUSDC_DECIMALS,
					marketObjectId: m.market_object_id,
					positionId: p.id
				});
			}
		} catch {
			/* sports best-effort */
		}
	}

	// Crypto: settled oracles where this side won.
	if (manager) {
		try {
			const { positions: cpos } = await getCryptoPositions(manager);
			for (const c of cpos) {
				if (!c.settled || c.won !== true) continue;
				items.push({
					kind: 'crypto',
					key: `${c.oracle_id}:${c.strike}:${c.is_up}`,
					label: `BTC ${c.is_up ? '≥' : '<'} $${c.strike.toLocaleString()} · ${c.is_up ? 'Up' : 'Down'}`,
					pick: c.is_up ? 'Up' : 'Down',
					payout: c.quantity,
					manager,
					oracleId: c.oracle_id,
					expiry: c.expiry,
					strike: c.strike,
					isUp: c.is_up,
					quantity: c.quantity
				});
			}
		} catch {
			/* crypto best-effort */
		}
	}

	return items;
}

// Shared source for the navbar badge, the on-load nudge, and the /claim page.
export const claimable = writable<ClaimableItem[]>([]);

let lastAddress: string | null = null;

/** Reload claimable winnings for a wallet and publish to the shared store. */
export async function refreshClaimable(
	walletAddress: string,
	suiClient: SuiClient
): Promise<ClaimableItem[]> {
	lastAddress = walletAddress;
	const items = await loadClaimable(walletAddress, suiClient);
	// Ignore a stale response if the wallet changed while we were loading.
	if (lastAddress === walletAddress) claimable.set(items);
	return items;
}

/** Clear on disconnect. */
export function clearClaimable(): void {
	lastAddress = null;
	claimable.set([]);
}
