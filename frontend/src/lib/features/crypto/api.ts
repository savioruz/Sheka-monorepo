import { request, unwrap } from '$lib/api';

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

export interface CryptoRecommendation {
	skip?: boolean;
	message?: string;
	model?: string;
	receipt_id?: string;
	blob_id?: string;
	public_blob_id?: string | null;
	content_sha256?: string | null;
	recommendation?: {
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
	};
}

/** Paid/free AI analysis for a crypto market (on-chain access proof + Walrus proof). */
export async function analyzeCrypto(
	oracleId: string,
	modelId: number,
	accessDigest: string,
	strike: number,
	isUp: boolean,
	token: string
): Promise<CryptoRecommendation> {
	const response = await request<{ data: CryptoRecommendation }>(
		`/api/crypto/markets/${encodeURIComponent(oracleId)}/analyze`,
		{
			method: 'POST',
			body: { model_id: modelId, access_tx_digest: accessDigest, strike, is_up: isUp },
			token
		}
	);
	return unwrap(response);
}
