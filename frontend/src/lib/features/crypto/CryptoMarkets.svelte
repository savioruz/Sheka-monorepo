<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { TrendingUp, TrendingDown } from '@lucide/svelte';
	import {
		getCryptoMarkets,
		getCryptoPositions,
		type CryptoMarket,
		type CryptoPosition
	} from './api';
	import { findManager, buildRedeemTransaction, DUSDC_SCALE } from './predict';
	import { suiClient } from '$lib/sui';
	import { signTransaction } from '$lib/features/wallet';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';
	import CryptoTradeDialog from './CryptoTradeDialog.svelte';

	let {
		walletAddress = null,
		sessionToken = null
	}: { walletAddress?: string | null; sessionToken?: string | null } = $props();

	let markets = $state<CryptoMarket[]>([]);
	let loading = $state(true);
	let now = $state(Date.now());

	let manager = $state<string | null>(null);
	let positions = $state<CryptoPosition[]>([]);
	let redeeming = $state<string | null>(null);

	let dialogOpen = $state(false);
	let selected = $state<CryptoMarket | null>(null);
	let selectedIsUp = $state(true);

	// Timeframe categories derived from the data: each market falls into the
	// smallest duration step ≥ its time-to-expiry; only non-empty steps are shown.
	const LADDER = [
		{ max: 5, label: '5m' },
		{ max: 15, label: '15m' },
		{ max: 30, label: '30m' },
		{ max: 60, label: '1h' },
		{ max: 120, label: '2h' },
		{ max: 240, label: '4h' },
		{ max: 720, label: '12h' },
		{ max: 1440, label: '1d' },
		{ max: 4320, label: '3d' },
		{ max: 10080, label: '1w' },
		{ max: Number.POSITIVE_INFINITY, label: '1w+' }
	];
	function bucketLabel(expiry: number): string {
		const mins = (expiry - now) / 60000;
		return (LADDER.find((s) => mins <= s.max) ?? LADDER[LADDER.length - 1]).label;
	}
	const frames = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const m of markets) {
			const l = bucketLabel(m.expiry);
			counts[l] = (counts[l] ?? 0) + 1;
		}
		return LADDER.filter((s) => counts[s.label]).map((s) => ({
			key: s.label,
			label: s.label,
			count: counts[s.label]
		}));
	});
	let frame = $state<string | null>(null);
	const currentFrame = $derived(
		frame && frames.some((f) => f.key === frame) ? frame : (frames[0]?.key ?? '')
	);
	const shownMarkets = $derived(markets.filter((m) => bucketLabel(m.expiry) === currentFrame));

	function trade(m: CryptoMarket, isUp: boolean) {
		selected = m;
		selectedIsUp = isUp;
		dialogOpen = true;
	}

	async function loadPositions() {
		if (!walletAddress) {
			positions = [];
			manager = null;
			return;
		}
		manager = manager ?? (await findManager(walletAddress));
		if (!manager) {
			positions = [];
			return;
		}
		try {
			positions = (await getCryptoPositions(manager)).positions;
		} catch {
			/* keep */
		}
	}

	// Reload positions when the trade dialog closes (a buy may have happened).
	// untrack: loadPositions reads `manager` synchronously — don't let this effect
	// depend on (and thus loop on) state that loadPositions itself writes.
	let prevOpen = false;
	$effect(() => {
		const o = dialogOpen;
		if (prevOpen && !o) untrack(() => void loadPositions());
		prevOpen = o;
	});

	async function redeem(p: CryptoPosition) {
		if (!manager || redeeming) return;
		redeeming = p.oracle_id + p.is_up;
		const toastId = toast.loading('Redeeming…');
		try {
			const tx = buildRedeemTransaction({
				manager,
				key: { oracleId: p.oracle_id, expiry: p.expiry, strike: p.strike, isUp: p.is_up },
				qty: BigInt(Math.round(p.quantity * DUSDC_SCALE))
			});
			const { bytes, signature } = await signTransaction(tx);
			const res = await suiClient.executeTransactionBlock({
				transactionBlock: bytes,
				signature,
				options: { showEffects: true }
			});
			toast.success('Redeemed', { id: toastId, description: `${res.digest.slice(0, 14)}…` });
			await loadPositions();
		} catch (err) {
			toast.error('Redeem failed', {
				id: toastId,
				description: err instanceof Error ? err.message : 'Redeem failed'
			});
		} finally {
			redeeming = null;
		}
	}

	onMount(() => {
		let poll: ReturnType<typeof setInterval> | undefined;
		let clock: ReturnType<typeof setInterval> | undefined;
		const stop = () => {
			clearInterval(poll);
			clearInterval(clock);
			poll = clock = undefined;
		};
		const start = () => {
			if (poll) return;
			poll = setInterval(() => {
				void load();
				void loadPositions();
			}, 30000);
			clock = setInterval(() => (now = Date.now()), 1000);
		};
		// Only poll/tick while the tab is visible — no background spam.
		const onVis = () => (document.visibilityState === 'visible' ? start() : stop());
		void load();
		void loadPositions();
		start();
		document.addEventListener('visibilitychange', onVis);
		return () => {
			stop();
			document.removeEventListener('visibilitychange', onVis);
		};
	});

	// Re-fetch positions when the wallet connects/changes. untrack the load so the
	// effect depends ONLY on walletAddress (loadPositions reads/writes `manager`,
	// which would otherwise create an infinite re-run loop).
	$effect(() => {
		void walletAddress;
		untrack(() => {
			manager = null;
			void loadPositions();
		});
	});

	async function load() {
		try {
			markets = (await getCryptoMarkets()).markets;
		} catch {
			/* keep */
		}
		loading = false;
	}

	const usd = (n: number | null) =>
		n == null ? '—' : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

	function countdown(expiry: number): string {
		const s = Math.max(0, Math.floor((expiry - now) / 1000));
		const m = Math.floor(s / 60);
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}h ${m % 60}m`;
		if (m > 0) return `${m}m ${s % 60}s`;
		return `${s}s`;
	}
</script>

<section class="p-5">
	<div class="md:flex md:gap-6">
		<!-- Timeframe categories: left sidebar on desktop, stacked on mobile -->
		<aside class="mb-4 md:mb-0 md:w-28 md:shrink-0 md:border-r md:border-border md:pr-4">
			<p
				class="mb-1 hidden px-1 text-[11px] font-semibold tracking-wide text-ink-subdued uppercase md:block"
			>
				Timeframe
			</p>
			<div class="flex flex-row flex-wrap gap-x-4 gap-y-1 text-sm md:flex-col md:gap-1">
				{#each frames as f (f.key)}
					<button
						type="button"
						onclick={() => (frame = f.key)}
						class="flex items-center justify-between gap-2 font-medium transition-colors {currentFrame ===
						f.key
							? 'text-primary'
							: 'text-ink-muted hover:text-ink'}"
					>
						{f.label}
						<span class="text-xs text-ink-subdued">{f.count}</span>
					</button>
				{/each}
			</div>
		</aside>

		<div class="min-w-0 md:flex-1">
			{#if positions.length > 0}
				<div class="mb-4 border border-border bg-card p-3 shadow-card">
					<p class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
						Your positions
					</p>
					<div class="space-y-2">
						{#each positions as p (p.oracle_id + p.is_up + p.strike)}
							{@const expired = now > p.expiry}
							<div class="flex items-center justify-between gap-2 text-xs">
								<span class="min-w-0 truncate text-ink-muted">
									<span class={p.is_up ? 'text-success' : 'text-error'}
										>{p.is_up ? 'Up' : 'Down'}</span
									>
									· BTC {p.is_up ? '≥' : '<'}
									{usd(p.strike)} · win
									<span class="font-medium text-ink">{p.quantity} DUSDC</span>
									· paid {p.cost.toFixed(2)}
								</span>
								{#if expired}
									<Button
										size="sm"
										class="h-7 shrink-0"
										onclick={() => redeem(p)}
										disabled={redeeming === p.oracle_id + p.is_up}
									>
										{redeeming === p.oracle_id + p.is_up ? 'Redeeming…' : 'Redeem'}
									</Button>
								{:else}
									<span class="shrink-0 text-ink-subdued">expires {countdown(p.expiry)}</span>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if loading && markets.length === 0}
				<div class="space-y-3">
					{#each [1, 2] as _i (_i)}
						<div class="h-24 animate-pulse border border-border bg-muted"></div>
					{/each}
				</div>
			{:else if markets.length === 0}
				<p class="py-8 text-center text-sm text-ink-muted">No live crypto markets right now.</p>
			{:else if shownMarkets.length === 0}
				<p class="py-8 text-center text-sm text-ink-muted">No markets in this timeframe.</p>
			{:else}
				<div class="space-y-3">
					{#each shownMarkets as m (m.oracle_id)}
						<div class="border border-border bg-card p-4 shadow-card">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<p class="text-sm font-semibold text-ink">{m.asset} price</p>
									<p class="text-xs text-ink-subdued">
										Will {m.asset} be higher at expiry? · spot {usd(m.spot)}
									</p>
								</div>
								<div class="flex flex-col items-end gap-0.5 text-xs">
									<span class="flex items-center gap-1 font-medium text-error">
										<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-error"></span>
										expires in {countdown(m.expiry)}
									</span>
									<span class="text-[11px] text-ink-subdued">strike ≥ {usd(m.min_strike)}</span>
								</div>
							</div>

							<div class="mt-3 grid grid-cols-2 gap-2">
								<button
									type="button"
									onclick={() => trade(m, true)}
									class="flex items-center justify-center gap-1 border border-border p-2 text-sm text-success transition-colors hover:border-success"
								>
									<TrendingUp class="h-4 w-4" /> Up
								</button>
								<button
									type="button"
									onclick={() => trade(m, false)}
									class="flex items-center justify-center gap-1 border border-border p-2 text-sm text-error transition-colors hover:border-error"
								>
									<TrendingDown class="h-4 w-4" /> Down
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</section>

<CryptoTradeDialog
	bind:open={dialogOpen}
	market={selected}
	isUp={selectedIsUp}
	{walletAddress}
	{sessionToken}
/>
