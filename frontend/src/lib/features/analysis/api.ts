import { API_BASE_URL, notifyUnauthorized, request, unwrap } from '$lib/api';
import type { Recommendation } from '$lib/features/markets/market';
import { ApiError } from '$lib/types';

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

// --- Background analysis job (job + poll: decouples the long LLM/Walrus work) ---

export interface AnalysisJobResponse<TRec = unknown> {
	status: 'running' | 'ready' | 'done' | 'error';
	recommendation: TRec | null;
	public_blob_id: string | null;
	blob_id: string | null;
	content_sha256: string | null;
	message: string | null;
}

/** Poll a background analysis job once by its receipt id. */
export async function getAnalysisJob<TRec = unknown>(
	receiptId: string,
	token: string
): Promise<AnalysisJobResponse<TRec>> {
	const response = await request<{ data: AnalysisJobResponse<TRec> }>(
		`/api/analysis/job/${encodeURIComponent(receiptId)}`,
		{ token }
	);
	return unwrap(response);
}

export interface PollHandlers<TRec> {
	onReady?: (rec: TRec) => void; // recommendation available (proof may still be uploading)
	onProof?: (proof: {
		public_blob_id: string | null;
		blob_id: string | null;
		content_sha256: string | null;
	}) => void; // Walrus proof stored
	onError?: (message: string) => void;
}

/**
 * Poll a job until it's done/errored or times out. Fires `onReady` once when the
 * recommendation first appears, then `onProof` when the Walrus proof is stored.
 * Returns the terminal outcome so the caller can resolve a pending UI/toast.
 */
export async function pollAnalysisJob<TRec = unknown>(
	receiptId: string,
	token: string,
	handlers: PollHandlers<TRec>,
	opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<'done' | 'error' | 'timeout'> {
	const interval = opts.intervalMs ?? 1500;
	const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
	let readyFired = false;
	while (Date.now() < deadline) {
		const job = await getAnalysisJob<TRec>(receiptId, token);
		if (job.status === 'error') {
			handlers.onError?.(job.message ?? 'Analysis failed');
			return 'error';
		}
		if (!readyFired && job.recommendation) {
			readyFired = true;
			handlers.onReady?.(job.recommendation);
		}
		if (job.status === 'done') {
			handlers.onProof?.({
				public_blob_id: job.public_blob_id,
				blob_id: job.blob_id,
				content_sha256: job.content_sha256
			});
			return 'done';
		}
		await new Promise((r) => setTimeout(r, interval));
	}
	return 'timeout';
}

// --- Streaming analysis (SSE), shared by sports + crypto ------------------------

export interface AnalysisStreamHandlers<TRec> {
	onStatus?: (stage: string, receiptId?: string) => void;
	onReasoning?: (text: string) => void;
	onRecommendation?: (rec: TRec) => void;
	onProof?: (p: {
		public_blob_id: string | null;
		blob_id: string | null;
		content_sha256: string | null;
	}) => void;
	onError?: (message: string) => void;
	onDone?: (receiptId: string) => void;
}

/**
 * POST to an SSE analyze endpoint and dispatch events to `handlers`. Resolves when
 * the stream closes. Throws `ApiError` on a non-2xx open (402/409/…) so the caller
 * can react. Uses fetch (not EventSource) so it can send the auth header + body.
 */
export async function streamAnalysis<TRec>(
	path: string,
	body: Record<string, unknown>,
	token: string,
	handlers: AnalysisStreamHandlers<TRec>,
	signal?: AbortSignal
): Promise<void> {
	const res = await fetch(`${API_BASE_URL}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'text/event-stream',
			Authorization: `Bearer ${token}`
		},
		body: JSON.stringify(body),
		signal
	});

	if (!res.ok || !res.body) {
		let message = `HTTP ${res.status}`;
		let errBody: unknown = null;
		try {
			errBody = await res.json();
			if (errBody && typeof errBody === 'object' && 'message' in errBody) {
				message = String((errBody as { message: unknown }).message);
			}
		} catch {
			/* non-JSON error body */
		}
		if (res.status === 401) notifyUnauthorized();
		throw new ApiError(message, res.status, errBody);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		for (;;) {
			const sep = buf.indexOf('\n\n');
			if (sep === -1) break;
			const frame = buf.slice(0, sep);
			buf = buf.slice(sep + 2);
			let event = 'message';
			let data = '';
			for (const line of frame.split('\n')) {
				if (line.startsWith('event:')) event = line.slice(6).trim();
				else if (line.startsWith('data:')) data += line.slice(5).replace(/^ /, '');
			}
			if (!data) continue;
			let parsed: Record<string, unknown>;
			try {
				parsed = JSON.parse(data);
			} catch {
				continue;
			}
			switch (event) {
				case 'status':
					handlers.onStatus?.(String(parsed.stage ?? ''), parsed.receipt_id as string | undefined);
					break;
				case 'reasoning':
					handlers.onReasoning?.(String(parsed.text ?? ''));
					break;
				case 'recommendation':
					handlers.onRecommendation?.(parsed as unknown as TRec);
					break;
				case 'proof':
					handlers.onProof?.(
						parsed as {
							public_blob_id: string | null;
							blob_id: string | null;
							content_sha256: string | null;
						}
					);
					break;
				case 'error':
					handlers.onError?.(String(parsed.message ?? 'Analysis failed'));
					break;
				case 'done':
					handlers.onDone?.(String(parsed.receipt_id ?? ''));
					break;
			}
		}
	}
}

export type SportsPick = NonNullable<Recommendation['recommendation']>;

/** Streaming sports analysis (SSE). */
export function streamAnalyzeMarket(
	marketObjectId: string,
	modelId: number,
	accessDigest: string,
	token: string,
	handlers: AnalysisStreamHandlers<SportsPick>,
	signal?: AbortSignal
): Promise<void> {
	return streamAnalysis<SportsPick>(
		`/api/markets/${encodeURIComponent(marketObjectId)}/analyze/stream`,
		{ model_id: modelId, access_tx_digest: accessDigest },
		token,
		handlers,
		signal
	);
}

// --- Sports pending-analysis persistence (resume across reload) -----------------

const MARKET_PENDING_KEY = 'sheka_pending_market_analysis';

export interface MarketPendingAnalysis {
	marketId: string;
	receiptId: string;
	accessDigest: string;
	modelId: number;
}

function readMarketPending(): Record<string, MarketPendingAnalysis> {
	try {
		const raw = localStorage.getItem(MARKET_PENDING_KEY);
		return raw ? (JSON.parse(raw) as Record<string, MarketPendingAnalysis>) : {};
	} catch {
		return {};
	}
}

export function saveMarketPending(p: MarketPendingAnalysis): void {
	try {
		const all = readMarketPending();
		all[p.marketId] = p;
		localStorage.setItem(MARKET_PENDING_KEY, JSON.stringify(all));
	} catch {
		/* best effort */
	}
}

export function getMarketPending(marketId: string): MarketPendingAnalysis | null {
	return readMarketPending()[marketId] ?? null;
}

export function clearMarketPending(marketId: string): void {
	try {
		const all = readMarketPending();
		delete all[marketId];
		localStorage.setItem(MARKET_PENDING_KEY, JSON.stringify(all));
	} catch {
		/* best effort */
	}
}
