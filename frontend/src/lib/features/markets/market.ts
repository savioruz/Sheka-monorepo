import type { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';

const PACKAGE_ID = import.meta.env.VITE_SHEKA_MARKET_PACKAGE_ID ?? '';
const DUSDC_TYPE = import.meta.env.VITE_DUSDC_TYPE ?? '';

export const OUTCOME = { HOME: 0, DRAW: 1, AWAY: 2 } as const;
export const OUTCOME_LABEL = ['Home', 'Draw', 'Away'];

/** Fetch a wallet's DUSDC coin objects (used to fund a stake). */
export async function getDusdcCoinObjects(
	suiClient: SuiClient,
	address: string,
	coinType: string
): Promise<{ objectId: string; balance: bigint }[]> {
	const { data } = await suiClient.getCoins({ owner: address, coinType });
	return data.map((coin) => ({ objectId: coin.coinObjectId, balance: BigInt(coin.balance) }));
}

export interface Market {
	market_object_id: string;
	event_id: string;
	sport: string;
	league: string;
	home: string;
	away: string;
	home_logo: string | null;
	away_logo: string | null;
	scheduled_at: string | null; // ISO kickoff time
	status: string; // 'open' | 'resolved'
	winner: number | null;
	pools: number[];
	total: number;
	implied_odds: number[]; // [home %, draw %, away %]
	// Live ESPN match status (refreshed server-side); drives the live clock chip.
	status_detail?: string | null; // e.g. "1st Half", "Halftime", "Full Time"
	period?: number | null;
	clock?: string | null; // e.g. "45'"
}

// ---------------------------------------------------------------------------
// Market browsing tabs — pure, testable helpers driven by kickoff time + status.
// ---------------------------------------------------------------------------

export type MarketTab = 'live' | 'starting_soon' | 'upcoming' | 'resolved' | 'hidden';

/**
 * Which tab a market belongs to, derived from its kickoff time and on-chain
 * status (no live feed): resolved → resolved; kickoff passed & open → live;
 * within `soonHours` → starting_soon; within `windowDays` → upcoming; further
 * out → hidden. Null kickoff (legacy/un-backfilled) → upcoming (shown undated).
 */
export function marketTab(
	market: Pick<Market, 'scheduled_at' | 'status'>,
	now: number,
	soonHours: number,
	windowDays: number
): MarketTab {
	if (market.status === 'resolved') return 'resolved';
	if (!market.scheduled_at) return 'upcoming';
	const kickoff = new Date(market.scheduled_at).getTime();
	if (Number.isNaN(kickoff)) return 'upcoming';
	if (kickoff <= now) return 'live';
	if (kickoff <= now + soonHours * 3_600_000) return 'starting_soon';
	if (kickoff <= now + windowDays * 86_400_000) return 'upcoming';
	return 'hidden';
}

/**
 * A market is "stale" when its kickoff is more than `liveMaxHours` in the past but
 * it still isn't resolved — i.e. the source likely froze (never reported `final`).
 * Used to show "Awaiting result" instead of a misleading "Live" pulse.
 */
export function isStale(
	market: Pick<Market, 'scheduled_at' | 'status'>,
	now: number,
	liveMaxHours: number
): boolean {
	if (market.status === 'resolved' || !market.scheduled_at) return false;
	const kickoff = new Date(market.scheduled_at).getTime();
	if (Number.isNaN(kickoff)) return false;
	return now - kickoff > liveMaxHours * 3_600_000;
}

/** Local day key for grouping (e.g. "2026-06-16"); null kickoff → "scheduled". */
export function marketDayKey(market: Pick<Market, 'scheduled_at'>): string {
	if (!market.scheduled_at) return 'scheduled';
	const d = new Date(market.scheduled_at);
	if (Number.isNaN(d.getTime())) return 'scheduled';
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Day header label, e.g. "Mon, Jun 16" (or "Scheduled" for undated). */
export function formatDayLabel(market: Pick<Market, 'scheduled_at'>): string {
	if (!market.scheduled_at) return 'Scheduled';
	const d = new Date(market.scheduled_at);
	if (Number.isNaN(d.getTime())) return 'Scheduled';
	return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Per-card time chip: "in 42m" / "in 3h" when imminent, else "Tue 2:00 PM". */
export function formatStartChip(scheduledAt: string | null, now: number): string {
	if (!scheduledAt) return 'TBD';
	const d = new Date(scheduledAt);
	const t = d.getTime();
	if (Number.isNaN(t)) return 'TBD';
	const diffMin = Math.round((t - now) / 60_000);
	if (diffMin <= 0) return 'Live';
	if (diffMin < 60) return `in ${diffMin}m`;
	if (diffMin < 240) return `in ${Math.round(diffMin / 60)}h`;
	return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * Short live label from the ESPN match status when a game is in progress:
 * "HT" at the break, "Final" when ended, the clock ("45'") otherwise. Returns
 * null when there's no live status (not started / no feed).
 */
export function liveLabel(market: Pick<Market, 'status_detail' | 'clock'>): string | null {
	const detail = market.status_detail?.trim();
	const clock = market.clock?.trim();
	if (detail && /half[- ]?time|halftime|\bHT\b|\bbreak\b|interval/i.test(detail)) return 'HT';
	if (detail && /full[- ]?time|\bFT\b|final|ended|full time/i.test(detail)) return 'Final';
	if (clock) return clock; // "45'"
	if (detail) return detail;
	return null;
}

// ---------------------------------------------------------------------------
// Parimutuel payout math (base units). pools/total/amount are all in T base
// units (DUSDC = 6 dp). Payout if an outcome wins = stake * total / outcome_pool.
// ---------------------------------------------------------------------------

/** Current value of an EXISTING position (its stake is already in `pools`/`total`). */
export function positionValue(
	amount: number,
	outcome: number,
	pools: number[],
	total: number
): { payout: number; pnl: number; roi: number } {
	const pool = pools[outcome] ?? 0;
	const payout = pool > 0 ? (amount * total) / pool : amount;
	const pnl = payout - amount;
	const roi = amount > 0 ? pnl / amount : 0;
	return { payout, pnl, roi };
}

/** Estimated payout if you stake `amount` on `outcome` now and it wins (incl. your stake). */
export function quoteStake(
	amount: number,
	outcome: number,
	pools: number[],
	total: number
): { payout: number; profit: number; roi: number } {
	const pool = (pools[outcome] ?? 0) + amount;
	const newTotal = total + amount;
	const payout = pool > 0 ? (amount * newTotal) / pool : amount;
	const profit = payout - amount;
	const roi = amount > 0 ? profit / amount : 0;
	return { payout, profit, roi };
}

export interface UserPosition {
	id: string;
	marketId: string;
	outcome: number;
	amount: number;
}

export interface NewsArticle {
	id: number | null;
	headline: string;
	description: string;
	published: string | null;
	thumbnail: string | null;
	type: string | null;
}

export interface Model {
	id: number;
	key: string;
	label: string;
	price_mist: number;
	price_sui: number;
	free: boolean;
}

export interface Recommendation {
	skip?: boolean;
	message?: string;
	model?: string;
	receipt_id?: string;
	blob_id?: string | null;
	recommendation?: {
		outcome: number;
		label: string;
		edge: number; // %
		has_edge: boolean;
		model_probs: number[]; // [home, draw, away] %
		implied_prob: number; // %
		confidence_tier: string;
		reasoning: string;
	};
}

/** Stake `amount` (DUSDC base units) on `outcome` of `marketId`. */
export function buildStakeTransaction(inputs: {
	marketId: string;
	outcome: number;
	amount: number;
	dusdcCoinObjectIds: string[];
}): Transaction {
	const tx = new Transaction();
	tx.setGasBudget(50_000_000);
	const coins = inputs.dusdcCoinObjectIds.map((id) => tx.object(id));
	const [primary, ...rest] = coins;
	if (rest.length > 0) tx.mergeCoins(primary, rest);
	const [stakeCoin] = tx.splitCoins(primary, [tx.pure.u64(inputs.amount)]);
	tx.moveCall({
		target: `${PACKAGE_ID}::market::stake`,
		typeArguments: [DUSDC_TYPE],
		arguments: [tx.object(inputs.marketId), tx.pure.u8(inputs.outcome), stakeCoin]
	});
	return tx;
}

/** Claim a resolved position's payout. */
export function buildClaimTransaction(inputs: {
	marketId: string;
	positionId: string;
}): Transaction {
	const tx = new Transaction();
	tx.setGasBudget(50_000_000);
	tx.moveCall({
		target: `${PACKAGE_ID}::market::claim`,
		typeArguments: [DUSDC_TYPE],
		arguments: [tx.object(inputs.marketId), tx.object(inputs.positionId)]
	});
	return tx;
}

/** All `Position` objects owned by `owner`. */
export async function fetchUserPositions(
	client: SuiClient,
	owner: string
): Promise<UserPosition[]> {
	const { data } = await client.getOwnedObjects({
		owner,
		filter: { StructType: `${PACKAGE_ID}::market::Position` },
		options: { showContent: true }
	});
	return data
		.map((o) => {
			const content = o.data?.content;
			if (!content || content.dataType !== 'moveObject') return null;
			const f = content.fields as { market_id: string; outcome: number | string; amount: string };
			return {
				id: o.data!.objectId,
				marketId: f.market_id,
				outcome: Number(f.outcome),
				amount: Number(f.amount)
			};
		})
		.filter((p): p is UserPosition => p !== null);
}
