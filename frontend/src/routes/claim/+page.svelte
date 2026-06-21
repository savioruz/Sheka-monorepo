<script lang="ts">
	import { suiClient } from '$lib/sui';
	import { signTransaction, getAuthStore } from '$lib/features/wallet';
	import { buildClaimTransaction } from '$lib/features/markets';
	import { buildRedeemTransaction, DUSDC_SCALE } from '$lib/features/crypto';
	import { claimable, refreshClaimable, type ClaimableItem } from '$lib/features/claims';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';

	const DUSDC_TYPE = import.meta.env.VITE_DUSDC_TYPE ?? '';

	const auth = getAuthStore();
	const walletAddress = $derived($auth.address);

	let loading = $state(false);
	let loadedFor = $state<string | null>(null);
	let busy = $state<string | null>(null);

	// Load (once) when a wallet is connected; reload if the wallet changes.
	$effect(() => {
		const addr = walletAddress;
		if (addr && loadedFor !== addr) void load(addr);
	});

	async function load(addr: string) {
		loading = true;
		loadedFor = addr;
		try {
			await refreshClaimable(addr, suiClient);
		} finally {
			loading = false;
		}
	}

	async function claim(item: ClaimableItem) {
		if (!walletAddress || busy) return;
		busy = item.key;
		const toastId = toast.loading(item.kind === 'sports' ? 'Claiming…' : 'Redeeming…');
		try {
			const tx =
				item.kind === 'sports'
					? buildClaimTransaction({
							marketId: item.marketObjectId,
							positionId: item.positionId
						})
					: buildRedeemTransaction({
							manager: item.manager,
							key: {
								oracleId: item.oracleId,
								expiry: item.expiry,
								strike: item.strike,
								isUp: item.isUp
							},
							qty: BigInt(Math.round(item.quantity * DUSDC_SCALE))
						});
			const { bytes, signature } = await signTransaction(tx);
			const res = await suiClient.executeTransactionBlock({
				transactionBlock: bytes,
				signature,
				options: { showEffects: true, showBalanceChanges: true }
			});
			// Sports pays the wallet directly; show the credited amount. Crypto redeems
			// into the manager balance, so just confirm with the digest.
			const dusdc = res.balanceChanges?.find((b) => b.coinType === DUSDC_TYPE);
			const credited = dusdc ? Number(dusdc.amount) / 1_000_000 : 0;
			toast.success(item.kind === 'sports' ? 'Claimed' : 'Redeemed', {
				id: toastId,
				description: credited > 0 ? `+${credited} DUSDC` : `${res.digest.slice(0, 12)}…`
			});
			await refreshClaimable(walletAddress, suiClient);
		} catch (err) {
			toast.error('Claim failed', {
				id: toastId,
				description: err instanceof Error ? err.message : 'Claim failed'
			});
		} finally {
			busy = null;
		}
	}

	const fmt = (n: number) => `${n.toFixed(2)} DUSDC`;
</script>

<svelte:head><title>Claim winnings · Sheka</title></svelte:head>

<main class="mx-auto max-w-2xl px-4 py-8 sm:px-6">
	<header class="mb-5">
		<h1 class="text-xl font-bold tracking-tight">Claim winnings</h1>
		<p class="mt-1 text-sm text-ink-muted">Your settled, winning positions — claim the payout.</p>
	</header>

	{#if !walletAddress}
		<p class="text-sm text-ink-subdued">Connect your wallet to see claimable winnings.</p>
	{:else if loading && $claimable.length === 0}
		<div class="space-y-2">
			{#each [1, 2] as _i (_i)}
				<div class="h-16 animate-pulse border border-border bg-muted"></div>
			{/each}
		</div>
	{:else if $claimable.length === 0}
		<p class="text-sm text-ink-subdued">No winnings to claim right now.</p>
	{:else}
		<ul class="space-y-2">
			{#each $claimable as item (item.key)}
				<li class="border border-border bg-card p-3 shadow-card">
					<div class="flex items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-ink">{item.label}</p>
							<p class="mt-0.5 text-xs text-ink-muted">
								<span class="text-success">Won</span>
								· {item.kind === 'sports' ? 'Sports' : 'Crypto'} · {item.pick}
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-3">
							<span class="text-sm font-semibold text-success">{fmt(item.payout)}</span>
							<Button
								size="sm"
								class="h-8"
								disabled={busy === item.key}
								onclick={() => claim(item)}
							>
								{busy === item.key ? '…' : item.kind === 'sports' ? 'Claim' : 'Redeem'}
							</Button>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</main>
