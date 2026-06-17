import type { Transaction } from '@mysten/sui/transactions';
import {
	getWallets,
	isWalletWithRequiredFeatureSet,
	SuiSignAndExecuteTransaction,
	SuiSignPersonalMessage,
	SuiSignTransaction,
	type WalletWithSuiFeatures
} from '@mysten/wallet-standard';

let cachedWallet: {
	wallet: WalletWithSuiFeatures;
	account: WalletWithSuiFeatures['accounts'][number];
} | null = null;

export interface ConnectedWallet {
	wallet: WalletWithSuiFeatures;
	account: WalletWithSuiFeatures['accounts'][number];
}

export function getAvailableWallets(): WalletWithSuiFeatures[] {
	if (typeof window === 'undefined') return [];
	return getWallets()
		.get()
		.filter((wallet): wallet is WalletWithSuiFeatures =>
			isWalletWithRequiredFeatureSet(wallet, [
				SuiSignPersonalMessage,
				SuiSignTransaction,
				SuiSignAndExecuteTransaction
			])
		);
}

export async function connectWallet(preferredName?: string): Promise<ConnectedWallet> {
	if (cachedWallet) return cachedWallet;

	const wallets = getAvailableWallets();
	if (wallets.length === 0) {
		throw new Error('No Sui wallet detected. Install Slush, Suiet, or another Sui wallet.');
	}

	const wallet = preferredName
		? (wallets.find((w) => w.name.toLowerCase().includes(preferredName.toLowerCase())) ??
			wallets[0])
		: wallets[0];

	await wallet.features['standard:connect'].connect();

	const account = wallet.accounts[0];
	if (!account) {
		throw new Error('No accounts granted');
	}

	cachedWallet = { wallet, account };
	return cachedWallet;
}

export async function disconnectWallet(): Promise<void> {
	const w = cachedWallet?.wallet;
	cachedWallet = null;
	try {
		// Actually disconnect (Enoki zkLogin → logout()/clear session) so the next
		// connect can pick a different account; extension wallets re-authorize.
		await w?.features['standard:disconnect']?.disconnect();
	} catch {
		/* ignore */
	}
}

/**
 * Re-establish a previously-authorized wallet WITHOUT a popup (silent connect),
 * so a page reload can restore the connection. Returns null if the wallet isn't
 * present or no longer authorizes silently (user must reconnect manually).
 */
export async function silentReconnect(preferredName?: string): Promise<ConnectedWallet | null> {
	if (cachedWallet) return cachedWallet;
	const wallets = getAvailableWallets();
	const wallet = preferredName
		? (wallets.find((w) => w.name === preferredName) ?? wallets[0])
		: wallets[0];
	if (!wallet) return null;
	try {
		await wallet.features['standard:connect'].connect({ silent: true });
	} catch {
		return null;
	}
	const account = wallet.accounts[0];
	if (!account) return null;
	cachedWallet = { wallet, account };
	return cachedWallet;
}

export async function signPersonalMessage(message: string): Promise<string> {
	if (!cachedWallet) {
		throw new Error('Wallet not connected');
	}
	const { wallet, account } = cachedWallet;

	const { signPersonalMessage: sign } = wallet.features[SuiSignPersonalMessage];
	const bytes = new TextEncoder().encode(message);
	// `chain` is required by the Enoki (zkLogin) wallet to pick its session/client.
	const result = await sign({ message: bytes, account, chain: appChain() });
	return result.signature;
}

// Sign raw bytes verbatim (e.g. a Seal SessionKey challenge), without the
// TextEncoder step signPersonalMessage applies to string input.
export async function signPersonalMessageBytes(message: Uint8Array): Promise<string> {
	if (!cachedWallet) {
		throw new Error('Wallet not connected');
	}
	const { wallet, account } = cachedWallet;
	const { signPersonalMessage: sign } = wallet.features[SuiSignPersonalMessage];
	const result = await sign({ message, account, chain: appChain() });
	return result.signature;
}

// Always sign for the network this app targets (e.g. sui:testnet), regardless of
// which network the wallet currently has selected — otherwise a wallet on mainnet
// resolves the tx against mainnet and fails with "Package object does not exist".
function appChain(): `${string}:${string}` {
	const network = import.meta.env.VITE_SUI_NETWORK ?? 'testnet';
	return `sui:${network}` as `${string}:${string}`;
}

export async function signTransaction(
	transaction: Transaction
): Promise<{ bytes: string; signature: string }> {
	if (!cachedWallet) {
		throw new Error('Wallet not connected');
	}
	const { wallet, account } = cachedWallet;

	const feature = wallet.features[SuiSignTransaction];
	if (!feature) {
		throw new Error('Wallet does not support sui:signTransaction');
	}

	const result = await feature.signTransaction({ transaction, account, chain: appChain() });
	return { bytes: result.bytes, signature: result.signature };
}

export async function signAndExecuteTransaction(transaction: Transaction): Promise<{
	digest: string;
	effects?: unknown;
}> {
	if (!cachedWallet) {
		throw new Error('Wallet not connected');
	}
	const { wallet, account } = cachedWallet;

	const { signAndExecuteTransaction: signAndExecute } =
		wallet.features[SuiSignAndExecuteTransaction];
	const result = await signAndExecute({ transaction, account, chain: appChain() });
	return { digest: result.digest, effects: result.effects };
}
