import { request, unwrap } from '$lib/api';
import { streamAnalysis, type AnalysisStreamHandlers } from '$lib/features/analysis';

export interface CryptoMarket {
	oracle_id: string;
	asset: string;
	expiry: number; // ms epoch
	status: string;
	spot: number | null; // USD
	min_strike: number; // USD
	tick_size: number; // USD
}

export interface CryptoPosition {
	oracle_id: string;
	strike: number; // USD
	is_up: boolean;
	expiry: number; // ms epoch
	quantity: number; // DUSDC payout if it wins
	cost: number; // DUSDC paid
	created_at: number; // ms epoch the position was placed
	settled: boolean; // oracle has a settlement price
	won: boolean | null; // null until settled; then did this side win
	settlement_price: number | null; // USD, once settled
}

/** Live DeepBook Predict crypto-price markets (soonest expiry first). */
export async function getCryptoMarkets(): Promise<{ markets: CryptoMarket[] }> {
	const response = await request<{ data: { markets: CryptoMarket[] } }>('/api/crypto/markets');
	return unwrap(response);
}

export interface CryptoNewsItem {
	title: string;
	link: string;
	description: string;
	published: string | null;
	source: string;
	image: string | null;
}

/** Aggregated crypto headlines from RSS (newest-first). */
export async function getCryptoNews(limit = 24): Promise<{ articles: CryptoNewsItem[] }> {
	const response = await request<{ data: { articles: CryptoNewsItem[] } }>(
		`/api/crypto/news?limit=${limit}`
	);
	return unwrap(response);
}

/** Open positions for a DeepBook Predict manager. */
export async function getCryptoPositions(
	manager: string
): Promise<{ positions: CryptoPosition[] }> {
	const response = await request<{ data: { positions: CryptoPosition[] } }>(
		`/api/crypto/positions?manager=${encodeURIComponent(manager)}`
	);
	return unwrap(response);
}

/** The model's pick for a crypto market (the polled job result). */
export interface CryptoPick {
	asset: string;
	side: 'Up' | 'Down';
	strike: number;
	model_prob: number; // %
	implied_prob: number | null; // %
	edge: number; // %
	has_edge: boolean;
	f_star: number; // % of bankroll (Kelly)
	confidence_tier: 'low' | 'medium' | 'high';
	reasoning: string;
}

/**
 * Start a paid/free AI analysis. The heavy work (LLM + Walrus proof) runs in the
 * background; this returns immediately with the receipt id to poll via
 * `getAnalysisJob` / `pollAnalysisJob`.
 */
export async function startAnalyzeCrypto(
	oracleId: string,
	modelId: number,
	accessDigest: string,
	strike: number,
	isUp: boolean,
	token: string
): Promise<{ receipt_id: string; status: string }> {
	const response = await request<{ data: { receipt_id: string; status: string } }>(
		`/api/crypto/markets/${encodeURIComponent(oracleId)}/analyze`,
		{
			method: 'POST',
			body: { model_id: modelId, access_tx_digest: accessDigest, strike, is_up: isUp },
			token
		}
	);
	return unwrap(response);
}

// --- Streaming analysis (SSE) ---------------------------------------------------

/** Streaming crypto analysis (SSE) — delegates to the shared stream reader. */
export function streamAnalyzeCrypto(
	oracleId: string,
	modelId: number,
	accessDigest: string,
	strike: number,
	isUp: boolean,
	token: string,
	handlers: AnalysisStreamHandlers<CryptoPick>,
	signal?: AbortSignal
): Promise<void> {
	return streamAnalysis<CryptoPick>(
		`/api/crypto/markets/${encodeURIComponent(oracleId)}/analyze/stream`,
		{ model_id: modelId, access_tx_digest: accessDigest, strike, is_up: isUp },
		token,
		handlers,
		signal
	);
}

// --- Pending-analysis persistence (resume across reload) ------------------------

const PENDING_KEY = 'sheka_pending_crypto_analysis';

export interface PendingAnalysis {
	oracleId: string;
	receiptId: string;
	accessDigest: string;
	modelId: number;
	strike: number;
	isUp: boolean;
}

function readPending(): Record<string, PendingAnalysis> {
	try {
		const raw = localStorage.getItem(PENDING_KEY);
		return raw ? (JSON.parse(raw) as Record<string, PendingAnalysis>) : {};
	} catch {
		return {};
	}
}

export function savePendingAnalysis(p: PendingAnalysis): void {
	try {
		const all = readPending();
		all[p.oracleId] = p;
		localStorage.setItem(PENDING_KEY, JSON.stringify(all));
	} catch {
		/* no storage — best effort */
	}
}

export function getPendingAnalysis(oracleId: string): PendingAnalysis | null {
	return readPending()[oracleId] ?? null;
}

export function clearPendingAnalysis(oracleId: string): void {
	try {
		const all = readPending();
		delete all[oracleId];
		localStorage.setItem(PENDING_KEY, JSON.stringify(all));
	} catch {
		/* best effort */
	}
}
