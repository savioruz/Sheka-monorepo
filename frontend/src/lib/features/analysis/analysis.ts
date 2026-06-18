import { Transaction } from '@mysten/sui/transactions';
import { fromHEX } from '@mysten/sui/utils';
import { SealClient, SessionKey } from '@mysten/seal';
import { suiClient } from '$lib/sui';
import { signPersonalMessageBytes } from '$lib/features/wallet';

const PACKAGE_ID = import.meta.env.VITE_SHEKA_ANALYSIS_PACKAGE_ID ?? '';
const REGISTRY_ID = import.meta.env.VITE_SHEKA_ANALYSIS_REGISTRY_ID ?? '';
const TREASURY_ID = import.meta.env.VITE_SHEKA_ANALYSIS_TREASURY_ID ?? '';
const QUOTA_ID = import.meta.env.VITE_SHEKA_ANALYSIS_QUOTA_ID ?? '';

const AGGREGATOR_URL = (
	import.meta.env.VITE_WALRUS_AGGREGATOR_URL ?? 'https://aggregator.walrus-testnet.walrus.space'
).replace(/\/$/, '');
// Testnet Seal key server (must match the backend's encrypt config).
const SEAL_KEY_SERVERS = ['0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75'];

/** Claim one free analysis on the Auto model (on-chain quota enforces the cap). */
export function buildClaimFreeTransaction(modelId: number): Transaction {
	const tx = new Transaction();
	tx.setGasBudget(50_000_000);
	tx.moveCall({
		target: `${PACKAGE_ID}::analysis::claim_free`,
		arguments: [tx.object(QUOTA_ID), tx.pure.u64(modelId)]
	});
	return tx;
}

/** Pay `priceMist` SUI for one analysis on `modelId` (price enforced on-chain). */
export function buildPurchaseTransaction(modelId: number, priceMist: number): Transaction {
	const tx = new Transaction();
	tx.setGasBudget(50_000_000);
	const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(priceMist)]);
	tx.moveCall({
		target: `${PACKAGE_ID}::analysis::purchase`,
		arguments: [tx.object(REGISTRY_ID), tx.object(TREASURY_ID), payment, tx.pure.u64(modelId)]
	});
	return tx;
}

// One Seal SessionKey per wallet, reused until it expires (avoids re-signing on
// every decrypt). Resets when the address changes.
let cachedSession: { key: SessionKey; address: string } | null = null;

async function getSessionKey(walletAddress: string): Promise<SessionKey> {
	if (cachedSession && cachedSession.address === walletAddress && !cachedSession.key.isExpired()) {
		return cachedSession.key;
	}
	const key = await SessionKey.create({
		address: walletAddress,
		packageId: PACKAGE_ID,
		ttlMin: 10,
		suiClient
	});
	const signature = await signPersonalMessageBytes(key.getPersonalMessage());
	await key.setPersonalMessageSignature(signature);
	cachedSession = { key, address: walletAddress };
	return key;
}

/**
 * Owner-only: fetch the Seal-encrypted analysis from Walrus and decrypt it.
 * Requires the wallet to still hold the matching `AnalysisReceipt` — the
 * contract's `seal_approve` aborts otherwise, so the key servers refuse the key.
 */
export async function decryptAnalysis(
	blobId: string,
	receiptId: string,
	walletAddress: string
): Promise<Record<string, unknown>> {
	const sealClient = new SealClient({
		suiClient,
		serverConfigs: SEAL_KEY_SERVERS.map((objectId) => ({ objectId, weight: 1 })),
		verifyKeyServers: false
	});

	const sessionKey = await getSessionKey(walletAddress);

	const res = await fetch(`${AGGREGATOR_URL}/v1/blobs/${blobId}`);
	if (!res.ok) throw new Error(`Could not read encrypted analysis (Walrus ${res.status})`);
	const ciphertext = new Uint8Array(await res.arrayBuffer());

	// seal_approve(id, receipt): proves on-chain that this wallet owns the receipt
	// for this analysis id; the key servers verify it before releasing the key.
	const tx = new Transaction();
	tx.moveCall({
		target: `${PACKAGE_ID}::analysis::seal_approve`,
		arguments: [tx.pure.vector('u8', fromHEX(receiptId)), tx.object(receiptId)]
	});
	const txBytes = await tx.build({ client: suiClient, onlyTransactionKind: true });

	const plaintext = await sealClient.decrypt({ data: ciphertext, sessionKey, txBytes });
	return JSON.parse(new TextDecoder().decode(plaintext));
}

// ---------------------------------------------------------------------------
// Public, verifiable proof bundle (plaintext on Walrus — no reasoning).
// ---------------------------------------------------------------------------

interface ProofTeam {
	team: string;
	score: number | null;
	injuries: { name: string; status: string }[];
	key_stats: { name: string; stat: string }[];
}

export interface PublicProof {
	schema_version: number;
	created_at: string;
	market: { id: string; home: string; away: string; league: string; sport: string };
	model: { id: number; label: string };
	inputs: {
		status: string;
		venue: string | null;
		home: ProofTeam;
		away: ProofTeam;
		news: string[];
	};
	ai: { model_probs: number[]; implied_prob: number; confidence_tier: string };
	kelly: {
		outcome: number;
		label: string;
		p: number;
		implied: number;
		edge: number;
		f_star: number;
	};
	content_sha256: string;
}

/** Stable JSON with recursively sorted keys — must match the backend `canonicalize`. */
function canonicalize(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
		return `{${entries.join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

async function sha256Hex(s: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Public Walrus aggregator URL for a blob (judges can open it directly). */
export function walrusBlobUrl(blobId: string): string {
	return `${AGGREGATOR_URL}/v1/blobs/${blobId}`;
}

/**
 * Fetch the PUBLIC proof bundle from Walrus and verify its integrity by
 * recomputing the content hash over the canonical bundle (minus the hash field).
 * No wallet needed — anyone can verify.
 */
export async function getPublicProof(
	publicBlobId: string
): Promise<{ proof: PublicProof; verified: boolean }> {
	const res = await fetch(walrusBlobUrl(publicBlobId));
	if (!res.ok) throw new Error(`Could not read proof (Walrus ${res.status})`);
	const proof = (await res.json()) as PublicProof;
	const { content_sha256, ...rest } = proof;
	const verified =
		Boolean(content_sha256) && (await sha256Hex(canonicalize(rest))) === content_sha256;
	return { proof, verified };
}
