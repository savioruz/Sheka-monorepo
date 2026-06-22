<script lang="ts">
	import { getMyAnalyses, ProofBadge, type OwnedAnalysis } from '$lib/features/analysis';
	import {
		fetchUserPositions,
		getMarkets,
		getModels,
		OUTCOME_LABEL,
		type UserPosition,
		type Market
	} from '$lib/features/markets';
	import { findManager, getCryptoPositions, type CryptoPosition } from '$lib/features/crypto';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { suiClient, formatBalance } from '$lib/sui';

	let {
		walletAddress = null,
		sessionToken = null,
		active = false
	}: { walletAddress?: string | null; sessionToken?: string | null; active?: boolean } = $props();

	let view = $state<'analyses' | 'positions'>('analyses');
	let loaded = $state(false);
	let analysesLoading = $state(false);
	let positionsLoading = $state(false);
	let analyses = $state<OwnedAnalysis[]>([]);
	let sportsPos = $state<UserPosition[]>([]);
	let cryptoPos = $state<CryptoPosition[]>([]);
	let modelLabels = $state<Record<number, string>>({});
	let marketMap = $state<Record<string, Market>>({});

	// Lazy-load once when the History tab first becomes active.
	$effect(() => {
		if (active && walletAddress && !loaded) void load();
	});

	async function load() {
		if (!walletAddress) return;
		loaded = true;

		if (sessionToken) {
			analysesLoading = true;
			try {
				analyses = (await getMyAnalyses(sessionToken)).analyses;
			} catch {
				/* keep empty */
			}
			analysesLoading = false;
		}
		getModels()
			.then((r) => {
				modelLabels = Object.fromEntries(r.models.map((m) => [m.id, m.label]));
			})
			.catch(() => {});

		positionsLoading = true;
		try {
			const [sports, manager] = await Promise.all([
				fetchUserPositions(suiClient, walletAddress).catch(() => [] as UserPosition[]),
				findManager(walletAddress).catch(() => null)
			]);
			sportsPos = sports;
			if (manager) {
				try {
					cryptoPos = (await getCryptoPositions(manager)).positions;
				} catch {
					/* keep */
				}
			}
			if (sportsPos.length > 0) {
				try {
					const mk = (await getMarkets()).markets;
					marketMap = Object.fromEntries(mk.map((m) => [m.market_object_id, m]));
				} catch {
					/* labels are best-effort */
				}
			}
		} catch {
			/* keep */
		}
		positionsLoading = false;
	}

	const usd = (n: number) => formatBalance(BigInt(Math.round(n)), 6);
	const suiscan = (id: string) => `https://suiscan.xyz/testnet/object/${id}`;
	function shortId(id: string | null): string {
		if (!id) return '—';
		return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
	}
	function fmtTime(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
	const fmtMs = (ms: number) => fmtTime(new Date(ms).toISOString());

	// Won/Lost/Open badge: green when this position beat its market/oracle, red when
	// it lost, neutral while still unsettled/unresolved.
	type WLBadge = { text: string; variant: BadgeVariant };
	function cryptoBadge(p: CryptoPosition): WLBadge {
		if (!p.settled) return { text: 'Open', variant: 'outline' };
		return p.won ? { text: 'Won', variant: 'default' } : { text: 'Lost', variant: 'destructive' };
	}
	function sportsBadge(p: UserPosition): WLBadge {
		const m = marketMap[p.marketId];
		if (!m || m.status !== 'resolved' || m.winner === null)
			return { text: 'Open', variant: 'outline' };
		return m.winner === p.outcome
			? { text: 'Won', variant: 'default' }
			: { text: 'Lost', variant: 'destructive' };
	}
</script>

<div class="min-w-0">
	<!-- Sub-switcher: AI analyses | Positions -->
	<div class="mb-3 flex items-center gap-4 border-b border-border pb-2 text-sm">
		<button
			type="button"
			onclick={() => (view = 'analyses')}
			class="font-medium transition-colors {view === 'analyses'
				? 'text-primary'
				: 'text-ink-muted hover:text-ink'}"
		>
			AI analyses
		</button>
		<button
			type="button"
			onclick={() => (view = 'positions')}
			class="font-medium transition-colors {view === 'positions'
				? 'text-primary'
				: 'text-ink-muted hover:text-ink'}"
		>
			Positions
		</button>
	</div>

	<div class="max-h-[55vh] overflow-y-auto">
		{#if view === 'analyses'}
			<!-- AI analyses -->
			{#if !sessionToken}
				<p class="text-xs text-ink-subdued">Sign in to view your analyses.</p>
			{:else if analysesLoading && analyses.length === 0}
				<div class="space-y-2">
					{#each [1, 2] as _i (_i)}
						<div class="h-12 animate-pulse border border-border bg-muted"></div>
					{/each}
				</div>
			{:else if analyses.length === 0}
				<p class="text-xs text-ink-subdued">No analyses yet.</p>
			{:else}
				<ul class="space-y-2">
					{#each analyses as a (a.receipt_id)}
						<li class="border border-border bg-card p-2.5 shadow-card">
							<!-- row 1: tx id · model -->
							<div class="flex items-center justify-between gap-2">
								<a
									href={suiscan(a.market_id)}
									target="_blank"
									rel="noopener noreferrer"
									class="min-w-0 truncate font-mono text-xs text-ink hover:text-primary"
								>
									{shortId(a.market_id)}
								</a>
								<span class="shrink-0 text-xs text-ink-muted">
									{modelLabels[a.model_id] ?? `model ${a.model_id}`}
								</span>
							</div>
							<!-- row 2: time · verified on walrus -->
							<div class="mt-1.5 flex items-center justify-between gap-2">
								<span class="text-[11px] text-ink-subdued">{fmtTime(a.created_at)}</span>
								{#if a.public_blob_id}
									<ProofBadge publicBlobId={a.public_blob_id} />
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{:else}
			<!-- Open positions -->
			{#if positionsLoading && sportsPos.length === 0 && cryptoPos.length === 0}
				<div class="space-y-2">
					{#each [1, 2] as _i (_i)}
						<div class="h-10 animate-pulse border border-border bg-muted"></div>
					{/each}
				</div>
			{:else if sportsPos.length === 0 && cryptoPos.length === 0}
				<p class="text-xs text-ink-subdued">No open positions.</p>
			{:else}
				<ul class="space-y-2">
					{#each cryptoPos as p (p.oracle_id + p.is_up + p.strike)}
						{@const cb = cryptoBadge(p)}
						<li class="border border-border bg-card p-2.5 shadow-card">
							<!-- row 1: tx id + result · amount -->
							<div class="flex items-center justify-between gap-2">
								<div class="flex min-w-0 items-center gap-2">
									<a
										href={suiscan(p.oracle_id)}
										target="_blank"
										rel="noopener noreferrer"
										class="min-w-0 truncate font-mono text-xs text-ink hover:text-primary"
									>
										{shortId(p.oracle_id)}
									</a>
									<Badge variant={cb.variant} class="shrink-0">{cb.text}</Badge>
								</div>
								<span class="shrink-0 text-xs font-medium text-ink">{p.cost.toFixed(2)} DUSDC</span>
							</div>
							<!-- row 2: placed date (left) · side/what (right) -->
							<div class="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
								<span class="shrink-0 text-ink-subdued">{fmtMs(p.created_at)}</span>
								<span class="min-w-0 truncate text-ink-muted">
									<span class={p.is_up ? 'text-success' : 'text-error'}
										>{p.is_up ? 'Up' : 'Down'}</span
									>
									· BTC {p.is_up ? '≥' : '<'} ${p.strike.toLocaleString()}
								</span>
							</div>
						</li>
					{/each}
					{#each sportsPos as p (p.id)}
						{@const sb = sportsBadge(p)}
						<li class="border border-border bg-card p-2.5 shadow-card">
							<!-- row 1: id + result · amount -->
							<div class="flex items-center justify-between gap-2">
								<div class="flex min-w-0 items-center gap-2">
									<a
										href={suiscan(p.marketId)}
										target="_blank"
										rel="noopener noreferrer"
										class="min-w-0 truncate font-mono text-xs text-ink hover:text-primary"
									>
										{shortId(p.marketId)}
									</a>
									<Badge variant={sb.variant} class="shrink-0">{sb.text}</Badge>
								</div>
								<span class="shrink-0 text-xs font-medium text-ink">{usd(p.amount)} DUSDC</span>
							</div>
							<!-- row 2: date (left) · matchup (right, picked side highlighted) -->
							<div class="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
								<span class="shrink-0 text-ink-subdued"
									>{fmtTime(marketMap[p.marketId]?.scheduled_at ?? null)}</span
								>
								<span class="min-w-0 truncate text-ink-muted">
									{#if marketMap[p.marketId]}
										<span class={p.outcome === 0 ? 'font-medium text-primary' : ''}
											>{marketMap[p.marketId]?.home}</span
										>
										vs
										<span class={p.outcome === 2 ? 'font-medium text-primary' : ''}
											>{marketMap[p.marketId]?.away}</span
										>{#if p.outcome === 1}<span class="text-primary"> · Draw</span>{/if}
									{:else}
										{OUTCOME_LABEL[p.outcome]}
									{/if}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</div>
