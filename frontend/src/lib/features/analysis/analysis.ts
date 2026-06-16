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
