<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { OUTCOME_LABEL, quoteStake, type Market } from './market';
	import { formatBalance } from '$lib/sui';

	const DECIMALS = 1_000_000; // DUSDC 6 dp

	let {
		open = $bindable(false),
		market = null,
		outcome = 0,
		balance = 0n, // wallet DUSDC, base units
		loading = false,
		onConfirm
	} = $props<{
		open?: boolean;
		market?: Market | null;
		outcome?: number;
		balance?: bigint;
		loading?: boolean;
		onConfirm: (amountBaseUnits: number) => void;
	}>();

	let amountStr = $state('1'); // nominal DUSDC, the source of truth

	const maxDusdc = $derived(Number(balance) / DECIMALS);
	const amountDusdc = $derived(Number(amountStr) || 0);
	const amount = $derived(Math.floor(amountDusdc * DECIMALS)); // base units
	const valid = $derived(amount >= DECIMALS && amount <= Number(balance));
	// Slider is a % of the wallet balance, derived from the nominal amount.
	const pct = $derived(
		maxDusdc > 0 ? Math.min(100, Math.round((amountDusdc / maxDusdc) * 100)) : 0
	);
	const quote = $derived(
		market && valid ? quoteStake(amount, outcome, market.pools, market.total) : null
	);

	// Dragging the % slider sets the nominal amount (≥1, 2 dp).
	function onSlider(e: Event) {
		const p = Number((e.currentTarget as HTMLInputElement).value);
		const v = (p / 100) * maxDusdc;
		amountStr = String(Math.max(1, Math.round(v * 100) / 100));
	}

	function confirm() {
		if (!valid || loading) return;
		onConfirm(amount);
	}
	const fmt = (n: number) => formatBalance(BigInt(Math.max(0, Math.round(n))), 6);
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		showCloseButton={!loading}
		onInteractOutside={(e) => loading && e.preventDefault()}
		onEscapeKeydown={(e) => loading && e.preventDefault()}
	>
		<Dialog.Header>
			<Dialog.Title>Stake on {market ? OUTCOME_LABEL[outcome] : ''}</Dialog.Title>
			{#if market}
				<Dialog.Description>{market.home} vs {market.away}</Dialog.Description>
			{/if}
		</Dialog.Header>

		<div class="space-y-3">
			<div>
				<label for="stake-amt" class="mb-1 block text-xs text-ink-muted">Amount (DUSDC)</label>
				<div class="flex items-center gap-2">
					<input
						id="stake-amt"
						type="number"
						min="1"
						step="0.01"
						bind:value={amountStr}
						disabled={loading}
						class="w-full border border-border bg-background px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
					/>
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={loading}
						onclick={() => (amountStr = String(Math.floor(maxDusdc * 100) / 100))}
					>
						Max
					</Button>
				</div>
				<input
					type="range"
					min="0"
					max="100"
					step="1"
					value={pct}
					oninput={onSlider}
					disabled={loading}
					aria-label="Percent of balance"
					class="mt-2 w-full accent-primary disabled:opacity-50"
				/>
				<div class="mt-1 flex justify-between text-[11px] text-ink-subdued">
					<span>{pct}% of balance</span>
					<span>Bal {maxDusdc.toFixed(2)} DUSDC</span>
				</div>
			</div>

			{#if quote}
				<div class="bg-primary-subtle/40 p-3 text-sm">
					<div class="flex items-center justify-between">
						<span class="text-ink-muted">If {OUTCOME_LABEL[outcome]} wins</span>
						<span class="font-mono font-semibold text-ink">{fmt(quote.payout)} DUSDC</span>
					</div>
					<div class="mt-0.5 flex items-center justify-between text-xs">
						<span class="text-ink-subdued">Potential profit</span>
						<span class="font-mono text-success">
							+{fmt(quote.profit)} ({(quote.roi * 100).toFixed(0)}%)
						</span>
					</div>
				</div>
			{:else}
				<p class="text-xs text-ink-subdued">
					Min 1 DUSDC · Balance {maxDusdc.toFixed(2)} DUSDC
				</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={loading}>Cancel</Button>
			<Button onclick={confirm} disabled={!valid || loading}>
				{loading ? 'Working…' : 'Sign & stake'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
