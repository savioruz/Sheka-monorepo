import { request, unwrap } from '$lib/api';
import type { Recommendation } from '$lib/features/markets/market';

export interface OwnedAnalysis {
	market_id: string;
	receipt_id: string;
	blob_id: string;
	public_blob_id: string | null;
	content_sha256: string | null;
	model_id: number;
}

/** Analyses the authenticated wallet owns (to re-view/decrypt across sessions). */
export async function getMyAnalyses(token: string): Promise<{ analyses: OwnedAnalysis[] }> {
	const response = await request<{ data: { analyses: OwnedAnalysis[] } }>('/api/analysis/mine', {
		token
	});
	return unwrap(response);
}

export async function getQuota(
	token: string
): Promise<{ free_used: number; free_limit: number; free_remaining: number }> {
	const response = await request<{
		data: { free_used: number; free_limit: number; free_remaining: number };
	}>('/api/analysis/quota', { token });
	return unwrap(response);
}

export async function analyzeMarket(
	marketObjectId: string,
	modelId: number,
	accessDigest: string,
	token: string
): Promise<Recommendation> {
	const response = await request<{ data: Recommendation }>(
		`/api/markets/${encodeURIComponent(marketObjectId)}/analyze`,
		{ method: 'POST', body: { model_id: modelId, access_tx_digest: accessDigest }, token }
	);
	return unwrap(response);
}
