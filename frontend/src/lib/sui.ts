import { SuiClient } from '@mysten/sui/client';

const SUI_RPC_URL = import.meta.env.VITE_SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443';

export const suiClient = new SuiClient({ url: SUI_RPC_URL });

export function formatBalance(balance: bigint, decimals: number): string {
	const divisor = 10n ** BigInt(decimals);
	const integer = balance / divisor;
	const fractional = balance % divisor;
	const fractionalStr = fractional.toString().padStart(decimals, '0').slice(0, 2);
	return `${integer}.${fractionalStr}`;
}
