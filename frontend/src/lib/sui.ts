import { SuiClient } from '@mysten/sui/client';

// Mysten's public JSON-RPC (fullnode.testnet.sui.io) is being shut down (2026-07); use a
// working public JSON-RPC node. Override via VITE_SUI_RPC_URL (build-time).
const SUI_RPC_URL = import.meta.env.VITE_SUI_RPC_URL ?? 'https://sui-testnet-rpc.publicnode.com';

export const suiClient = new SuiClient({ url: SUI_RPC_URL });

export function formatBalance(balance: bigint, decimals: number): string {
	const divisor = 10n ** BigInt(decimals);
	const integer = balance / divisor;
	const fractional = balance % divisor;
	const fractionalStr = fractional.toString().padStart(decimals, '0').slice(0, 2);
	return `${integer}.${fractionalStr}`;
}
