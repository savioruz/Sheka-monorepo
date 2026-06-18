<script lang="ts">
	import { onMount } from 'svelte';
	import { getMarkets, getModels } from './api';
	import {
		getQuota,
		getMyAnalyses,
		getAnalysisJob,
		pollAnalysisJob,
		streamAnalyzeMarket,
		getMarketPending,
		saveMarketPending,
		clearMarketPending,
		ProofBadge
	} from '$lib/features/analysis';
	import { ApiError } from '$lib/types';
	import {
		fetchUserPositions,
		marketTab,
		marketDayKey,
		formatDayLabel,
		formatStartChip,
		isStale,
		liveLabel,
		positionValue,
		OUTCOME_LABEL,
		type Market,
		type MarketTab,
		type UserPosition,
		type Model,
		type Recommendation
	} from './market';
	import {
		buildClaimFreeTransaction,
		buildPurchaseTransaction,
		decryptAnalysis
	} from '$lib/features/analysis';
	import { suiClient, formatBalance } from '$lib/sui';
	import { signTransaction } from '$lib/features/wallet';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Separator } from '$lib/components/ui/separator';
	import { ChevronsUpDown, ChevronDown, Sparkles } from '@lucide/svelte';
	import { leagueLabel, sportEmoji, titleCaseSport } from '$lib/utils';
	import { SPORT_CATEGORIES } from '$lib/categories';
	import { toast } from 'svelte-sonner';

	const SOON_HOURS = Number(import.meta.env.VITE_STARTING_SOON_HOURS ?? 3);
	const WINDOW_DAYS = Number(import.meta.env.VITE_UPCOMING_WINDOW_DAYS ?? 7);
	const LIVE_MAX_HOURS = Number(import.meta.env.VITE_LIVE_MAX_HOURS ?? 4);

	let {
		walletAddress = $bindable<string | null>(null),
		sessionToken = $bindable<string | null>(null),
		onStake,
		onClaim
	} = $props<{
		walletAddress?: string | null;
		sessionToken?: string | null;
		onStake: (market: Market, outcome: number) => void;
		onClaim: (market: Market, position: UserPosition) => void;
	}>();

	type Pick = NonNullable<Recommendation['recommendation']>;

	let markets = $state<Market[]>([]);
	let positions = $state<UserPosition[]>([]);
	let modelsList = $state<Model[]>([]);
	let freeRemaining = $state<number | null>(null);
	let loading = $state(true);
	let recs = $state<Record<string, Pick>>({});
	let sealRef = $state<Record<string, { blobId: string; receiptId: string }>>({});
	// market_object_id → public proof blob id (plaintext, hash-verifiable on Walrus).
	let proofRef = $state<Record<string, string>>({});
	let selectedModel = $state<Record<string, number>>({});
	let analyzing = $state<string | null>(null);
	let decrypting = $state<string | null>(null);
	let expandedReason = $state<Record<string, boolean>>({});
	// Streaming (SSE): live prose + stage + proof-uploading, keyed by market id.
	let streamReasoning = $state<Record<string, string>>({});
	let stage = $state<Record<string, string>>({});
	let proofPending = $state<Record<string, boolean>>({});
	let resumed = $state<Record<string, boolean>>({});

	// Browsing state: a clock kept fresh for countdowns + bucket transitions, plus
	// the sidebar filters (event category + sport + league).
	let now = $state(Date.now());
	let sportFilter = $state<string>('all');
	let leagueFilter = $state<string | null>(null);

	// Bucket markets by state (after the sport/league filters), recomputed as `now` ticks.
	const byTab = $derived.by(() => {
		const g: Record<MarketTab, Market[]> = {
			live: [],
			starting_soon: [],
			upcoming: [],
			resolved: [],
			hidden: []
		};
		for (const m of markets) {
			if (sportFilter !== 'all' && m.sport !== sportFilter) continue;
			if (leagueFilter && m.league !== leagueFilter) continue;
			g[marketTab(m, now, SOON_HOURS, WINDOW_DAYS)].push(m);
		}
		return g;
	});

	function ts(m: Market): number {
		const t = m.scheduled_at ? new Date(m.scheduled_at).getTime() : NaN;
		return Number.isNaN(t) ? 8.64e15 : t; // undated sort last
	}
	const byTime = (a: Market, b: Market) => ts(a) - ts(b);

	// Live + Starting Soon form one category; Upcoming and Resolved follow.
	const live = $derived(byTab.live.slice().sort(byTime));
	const soon = $derived(byTab.starting_soon.slice().sort(byTime));
	const upcoming = $derived(byTab.upcoming.slice().sort(byTime));
	const resolved = $derived(byTab.resolved.slice().sort((a, b) => ts(b) - ts(a)));

	// Upcoming grouped by day (undated "Scheduled" group last).
	const dayGroups = $derived.by(() => {
		const groups: Record<string, { label: string; items: Market[] }> = {};
		for (const m of upcoming) {
			const key = marketDayKey(m);
			(groups[key] ??= { label: formatDayLabel(m), items: [] }).items.push(m);
		}
		return Object.entries(groups)
			.sort((a, b) => (a[0] === 'scheduled' ? 1 : b[0] === 'scheduled' ? -1 : a[0] < b[0] ? -1 : 1))
			.map((e) => e[1]);
	});

	// Top-level categories (Live bundles Live + Starting Soon), selected via a
	// plain text switcher. Defaults to the first non-empty category.
	type Cat = 'live' | 'upcoming' | 'resolved';
	const categories = $derived([
		{ key: 'live', label: 'Live', count: live.length + soon.length },
		{ key: 'upcoming', label: 'Upcoming', count: upcoming.length },
		{ key: 'resolved', label: 'Resolved', count: resolved.length }
	] as { key: Cat; label: string; count: number }[]);
	let category = $state<Cat | null>(null);
	const currentCategory = $derived(category ?? categories.find((c) => c.count > 0)?.key ?? 'live');
	const currentCount = $derived(categories.find((c) => c.key === currentCategory)?.count ?? 0);

	// Which event category a market belongs to (Live bundles live + starting_soon).
	function eventOf(m: Market): Cat | null {
		const t = marketTab(m, now, SOON_HOURS, WINDOW_DAYS);
		if (t === 'live' || t === 'starting_soon') return 'live';
		if (t === 'upcoming') return 'upcoming';
		if (t === 'resolved') return 'resolved';
		return null; // hidden
	}

	// Market counts per sport/league within the current event category (ignores the
	// sport/league filter, so the sidebar tree shows what's available to switch to).
	const sportCounts = $derived.by(() => {
		const bySport: Record<string, number> = {};
		const byLeague: Record<string, number> = {};
		for (const m of markets) {
			if (eventOf(m) !== currentCategory) continue;
			bySport[m.sport] = (bySport[m.sport] ?? 0) + 1;
			byLeague[m.league] = (byLeague[m.league] ?? 0) + 1;
		}
		return { bySport, byLeague };
	});

	// Sidebar sport filter selection.
	const allSports = $derived(sportFilter === 'all' && !leagueFilter);
	function selectSport(sport: string) {
		sportFilter = sport;
		leagueFilter = null;
	}
	function selectLeague(sport: string, slug: string) {
		sportFilter = sport;
		leagueFilter = slug;
	}
	function clearSport() {
		sportFilter = 'all';
		leagueFilter = null;
	}

	// Label for the mobile sport dropdown trigger.
	const currentSportLabel = $derived.by(() => {
		if (leagueFilter) return `${sportEmoji(sportFilter)} ${leagueLabel(leagueFilter)}`;
		if (sportFilter !== 'all') return `${sportEmoji(sportFilter)} ${titleCaseSport(sportFilter)}`;
		return 'All sports';
	});

	// Desktop tree: which sport <details> is expanded (single-open).
	let openSport = $state<string | null>(null);
	function toggleSport(e: Event, sport: string) {
		e.preventDefault();
		openSport = openSport === sport ? null : sport;
	}

	async function load() {
		try {
			markets = (await getMarkets()).markets;
		} catch {
			/* keep */
		}
		if (walletAddress) {
			try {
				positions = await fetchUserPositions(suiClient, walletAddress);
			} catch {
				positions = [];
			}
		} else {
			positions = [];
		}
		loading = false;
	}

	// Exposed via bind:this so the page can refresh pools/positions immediately
	// after a stake/claim (instead of waiting for the 15s poll).
	export function reload() {
		void load();
	}

	async function loadModels() {
		try {
			modelsList = (await getModels()).models;
		} catch {
			/* keep */
		}
		if (sessionToken) {
			try {
				freeRemaining = (await getQuota(sessionToken)).free_remaining;
			} catch {
				freeRemaining = null;
			}
			await refreshOwned();
		}
	}

	// Surface analyses this wallet already owns so they can be re-decrypted across
	// sessions (latest per market; the list is newest-first). Polled too, so an
	// analysis that finished server-side after a mid-run reload reappears on its own.
	async function refreshOwned() {
		if (!sessionToken) return;
		try {
			const { analyses } = await getMyAnalyses(sessionToken);
			for (const a of analyses) {
				if (a.market_id && a.blob_id && !sealRef[a.market_id]) {
					sealRef[a.market_id] = { blobId: a.blob_id, receiptId: a.receipt_id };
				}
				if (a.market_id && a.public_blob_id) proofRef[a.market_id] = a.public_blob_id;
			}
		} catch {
			/* ignore */
		}
	}

	function modelFor(marketId: string): Model | undefined {
		const id = selectedModel[marketId] ?? 0;
		return modelsList.find((m) => m.id === id);
	}

	// Price/free suffix for a model in the picker (free runs while Auto quota lasts).
	function modelSuffix(model: Model | undefined): string {
		if (!model) return '';
		return model.free && (freeRemaining ?? 0) > 0
			? `${freeRemaining} free left`
			: `${model.price_sui} SUI`;
	}

	function positionsFor(marketId: string): UserPosition[] {
		return positions.filter((p) => p.marketId === marketId);
	}

	function fmt(units: number): string {
		return formatBalance(BigInt(Math.round(units)), 6);
	}

	// Hide a broken/missing team crest cleanly.
	function hideImg(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}

	// Fresh analysis: pay/claim on-chain, then open the SSE stream with that digest.
	async function analyze(market: Market) {
		if (!walletAddress || !sessionToken) {
			toast.error('Connect your wallet first');
			return;
		}
		if (analyzing) return;
		const model = modelFor(market.market_object_id);
		if (!model) return;

		const useFree = model.free && (freeRemaining ?? 0) > 0;
		analyzing = market.market_object_id;
		const toastId = toast.loading(
			useFree ? 'Claiming free analysis…' : `Paying ${model.price_sui} SUI…`,
			{ description: 'Approve the wallet popup.', dismissible: false }
		);
		try {
			const tx = useFree
				? buildClaimFreeTransaction(model.id)
				: buildPurchaseTransaction(model.id, model.price_mist);
			const { bytes, signature } = await signTransaction(tx);
			const res = await suiClient.executeTransactionBlock({
				transactionBlock: bytes,
				signature,
				options: { showEffects: true }
			});
			toast.loading(`Running ${model.label}…`, { id: toastId, dismissible: false });
			await runStream(market, model.id, res.digest, toastId);
		} catch (err) {
			toast.error('Analyze failed', {
				id: toastId,
				description: err instanceof Error ? err.message : String(err),
				dismissible: true
			});
			analyzing = null;
		}
	}

	// Open the SSE stream (fresh or resumed digest). Streams reasoning → recommendation
	// → proof, persisting `pending` so a reload can recover it (no second payment).
	async function runStream(
		market: Market,
		modelId: number,
		accessDigest: string,
		toastId: string | number
	) {
		if (!sessionToken) return;
		const token = sessionToken;
		const id = market.market_object_id;
		const label = modelsList.find((m) => m.id === modelId)?.label ?? 'AI';
		let receiptId = '';

		streamReasoning[id] = '';
		delete recs[id];
		analyzing = id;
		stage[id] = 'starting';
		try {
			await streamAnalyzeMarket(id, modelId, accessDigest, token, {
				onStatus: (s, rid) => {
					stage[id] = s;
					if (rid) {
						receiptId = rid;
						saveMarketPending({ marketId: id, receiptId: rid, accessDigest, modelId });
					}
				},
				onReasoning: (t) => {
					streamReasoning[id] = (streamReasoning[id] ?? '') + t;
				},
				onRecommendation: (r) => {
					recs[id] = r;
					analyzing = null;
					proofPending[id] = true;
					toast.success('Analysis ready', {
						id: toastId,
						description: `${label}: ${r.label}`,
						dismissible: true
					});
				},
				onProof: (p) => {
					proofPending[id] = false;
					if (p.public_blob_id) proofRef[id] = p.public_blob_id;
					if (p.blob_id) sealRef[id] = { blobId: p.blob_id, receiptId };
					clearMarketPending(id);
				},
				onError: (m) => {
					toast.error('No result (retry — you were not charged)', {
						id: toastId,
						description: m,
						dismissible: true
					});
				},
				onDone: () => clearMarketPending(id)
			});
			try {
				freeRemaining = (await getQuota(token)).free_remaining;
			} catch {
				/* ignore */
			}
		} catch (err) {
			const e = err instanceof ApiError ? err : null;
			if (e?.status === 409) {
				toast.dismiss(toastId);
				await refreshOwned();
			} else {
				toast.error('Analyze failed', {
					id: toastId,
					description: e?.message ?? String(err),
					dismissible: true
				});
			}
		} finally {
			if (analyzing === id) analyzing = null;
			proofPending[id] = false;
			stage[id] = '';
		}
	}

	// Resume an analysis interrupted by a reload — no new payment.
	async function resumePending(
		market: Market,
		pending: NonNullable<ReturnType<typeof getMarketPending>>,
		token: string
	) {
		const id = market.market_object_id;
		try {
			const job = await getAnalysisJob<Pick>(pending.receiptId, token);
			if (job.status === 'done') {
				if (job.recommendation) recs[id] = job.recommendation;
				if (job.public_blob_id) proofRef[id] = job.public_blob_id;
				if (job.blob_id) sealRef[id] = { blobId: job.blob_id, receiptId: pending.receiptId };
				clearMarketPending(id);
				return;
			}
			if (job.status === 'running' || job.status === 'ready') {
				if (job.recommendation) recs[id] = job.recommendation;
				proofPending[id] = true;
				await pollAnalysisJob<Pick>(pending.receiptId, token, {
					onReady: (r) => {
						recs[id] = r;
					},
					onProof: (p) => {
						proofPending[id] = false;
						if (p.public_blob_id) proofRef[id] = p.public_blob_id;
						if (p.blob_id) sealRef[id] = { blobId: p.blob_id, receiptId: pending.receiptId };
						clearMarketPending(id);
					},
					onError: () => {
						proofPending[id] = false;
					}
				});
				return;
			}
		} catch (err) {
			if (err instanceof ApiError && err.status !== 404) return;
		}
		const toastId = toast.loading('Resuming analysis…', {
			description: 'Picking up where you left off.',
			dismissible: false
		});
		await runStream(market, pending.modelId, pending.accessDigest, toastId);
	}

	// Proves owner-only access: re-fetch the ciphertext from Walrus and decrypt it
	// client-side via Seal (SessionKey + on-chain seal_approve). Only works while
	// the wallet still holds the matching receipt.
	async function decrypt(market: Market) {
		const ref = sealRef[market.market_object_id];
		if (!ref || !walletAddress || decrypting) return;
		decrypting = market.market_object_id;
		const toastId = toast.loading('Decrypting from Walrus…', {
			description: 'Sign the Seal session request.'
		});
		try {
			const plain = await decryptAnalysis(ref.blobId, ref.receiptId, walletAddress);
			recs[market.market_object_id] = plain as unknown as Pick;
			toast.success('Decrypted — you own this analysis', { id: toastId });
		} catch (err) {
			toast.error('Decrypt failed', {
				id: toastId,
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			decrypting = null;
		}
	}

	// Resume analyses interrupted by a reload (saved in localStorage), once per market.
	$effect(() => {
		const token = sessionToken;
		if (!token || markets.length === 0) return;
		for (const m of markets) {
			const id = m.market_object_id;
			if (resumed[id] || recs[id] || analyzing === id) continue;
			const pending = getMarketPending(id);
			if (!pending) continue;
			resumed[id] = true;
			void resumePending(m, pending, token);
		}
	});

	onMount(() => {
		void load();
		void loadModels();
		const i = setInterval(() => {
			void load();
			void refreshOwned();
		}, 15000);
		const clock = setInterval(() => (now = Date.now()), 30000);
		return () => {
			clearInterval(i);
			clearInterval(clock);
		};
	});

	$effect(() => {
		if (sessionToken) void loadModels();
	});
</script>

{#snippet marketCard(m: Market)}
	{@const resolved = m.status === 'resolved'}
	{@const myPos = positionsFor(m.market_object_id)}
	{@const pick = recs[m.market_object_id]}
	{@const chip = formatStartChip(m.scheduled_at, now)}
	<div class="relative border border-border bg-card p-4 shadow-card">
		<!-- Stretched link: clicking anywhere on the card (except the z-10 controls
		     below) opens the market detail page. -->
		<a
			href="/market/{m.market_object_id}"
			class="absolute inset-0 z-0"
			aria-label="View {m.home} vs {m.away}"
		></a>
		<div class="mb-3 flex items-start justify-between gap-2">
			<div class="min-w-0">
				<p class="flex items-center gap-1.5 truncate text-sm font-semibold text-ink">
					{#if m.home_logo}
						<img
							src={m.home_logo}
							alt=""
							width="16"
							height="16"
							loading="lazy"
							decoding="async"
							class="h-4 w-4 shrink-0 object-contain"
							onerror={hideImg}
						/>
					{/if}
					{m.home}
					<span class="text-ink-subdued">vs</span>
					{#if m.away_logo}
						<img
							src={m.away_logo}
							alt=""
							width="16"
							height="16"
							loading="lazy"
							decoding="async"
							class="h-4 w-4 shrink-0 object-contain"
							onerror={hideImg}
						/>
					{/if}
					{m.away}
				</p>
				<p class="text-xs text-ink-subdued">{leagueLabel(m.league)}</p>
			</div>
			<div class="flex flex-col items-end gap-0.5 text-xs">
				{#if resolved}
					<span class="font-semibold text-success"
						>Settled · {OUTCOME_LABEL[m.winner ?? 0]} won</span
					>
				{:else if isStale(m, now, LIVE_MAX_HOURS)}
					<span class="font-medium text-ink-muted">Awaiting result</span>
				{:else if chip === 'Live'}
					<span class="flex items-center gap-1 font-semibold text-error">
						<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-error"></span>{liveLabel(m) ??
							'Live'}
					</span>
				{:else}
					<span class="font-medium text-ink-muted">{chip}</span>
				{/if}
				<span class="text-[11px] text-ink-subdued">Pool {fmt(m.total)} DUSDC</span>
			</div>
		</div>

		<div class="grid grid-cols-3 gap-2">
			{#each [0, 1, 2] as o (o)}
				<div
					class="p-2 text-center {resolved && m.winner === o
						? 'ring-1 ring-success'
						: ''} {!resolved && pick?.outcome === o ? 'ring-2 ring-primary' : ''}"
				>
					<p class="flex items-center justify-center gap-1 text-[11px] text-ink-muted">
						{#if o === 0 && m.home_logo}
							<img
								src={m.home_logo}
								alt=""
								width="14"
								height="14"
								loading="lazy"
								decoding="async"
								class="h-3.5 w-3.5 object-contain"
								onerror={hideImg}
							/>
						{:else if o === 2 && m.away_logo}
							<img
								src={m.away_logo}
								alt=""
								width="14"
								height="14"
								loading="lazy"
								decoding="async"
								class="h-3.5 w-3.5 object-contain"
								onerror={hideImg}
							/>
						{/if}
						<span class="truncate">{o === 0 ? m.home : o === 2 ? m.away : 'Draw'}</span>
					</p>
					<p class="font-mono text-sm font-bold text-ink">{m.implied_odds[o] ?? 0}%</p>
					{#if !resolved && walletAddress}
						<Button
							size="sm"
							variant="outline"
							class="relative z-10 mt-1 w-full"
							onclick={() => onStake(m, o)}
						>
							Stake
						</Button>
					{/if}
				</div>
			{/each}
		</div>

		<!-- AI analysis: pick model + analyze (free Auto or paid) -->
		{#if !resolved && walletAddress}
			<div class="relative z-10 mt-3 flex items-center gap-2">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" size="sm" class="flex-1 justify-between gap-2">
								<span class="truncate">{modelFor(m.market_object_id)?.label ?? 'Auto'}</span>
								<span class="flex shrink-0 items-center gap-1 text-ink-subdued">
									{modelSuffix(modelFor(m.market_object_id))}
									<ChevronsUpDown class="h-3.5 w-3.5 opacity-60" />
								</span>
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="w-60" align="start">
						<DropdownMenu.RadioGroup
							value={String(selectedModel[m.market_object_id] ?? 0)}
							onValueChange={(v) => (selectedModel[m.market_object_id] = Number(v))}
						>
							{#each modelsList as model (model.id)}
								<DropdownMenu.RadioItem value={String(model.id)}>
									<span class="flex w-full items-center justify-between gap-3">
										<span>{model.label}</span>
										<span class="text-xs text-ink-subdued">{modelSuffix(model)}</span>
									</span>
								</DropdownMenu.RadioItem>
							{/each}
						</DropdownMenu.RadioGroup>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<Button
					size="sm"
					onclick={() => analyze(m)}
					disabled={analyzing === m.market_object_id || proofPending[m.market_object_id]}
				>
					{#if analyzing === m.market_object_id}
						Analyzing…
					{:else}
						<Sparkles class="h-3.5 w-3.5" /> Analyze
					{/if}
				</Button>
			</div>
		{/if}

		{#if pick}
			<div class="mt-2 bg-primary-subtle/40 p-2 text-xs">
				<p class="font-semibold text-primary-deep">
					🤖 {pick.label}
					{#if pick.has_edge}· <span class="text-success">+{pick.edge}% edge</span>{:else}·
						<span class="text-ink-muted">no edge</span>{/if}
					· {pick.confidence_tier}
				</p>
				<p class="mt-0.5 text-ink-muted">
					Model H/D/A: {pick.model_probs[0]}/{pick.model_probs[1]}/{pick.model_probs[2]}%
				</p>
				<button
					type="button"
					class="relative z-10 mt-1 block w-full cursor-pointer text-left text-ink-subdued {expandedReason[
						m.market_object_id
					]
						? 'whitespace-pre-line'
						: 'line-clamp-3'}"
					title={expandedReason[m.market_object_id] ? 'Show less' : 'Show more'}
					onclick={() => (expandedReason[m.market_object_id] = !expandedReason[m.market_object_id])}
				>
					{pick.reasoning}
				</button>
				{#if proofRef[m.market_object_id] || sealRef[m.market_object_id]}
					<div class="mt-2 flex flex-col gap-1 pt-2">
						{#if proofRef[m.market_object_id]}
							<ProofBadge publicBlobId={proofRef[m.market_object_id]} />
						{/if}
						{#if sealRef[m.market_object_id]}
							<span class="truncate text-[10px] text-ink-muted"
								>🔒 Full reasoning Seal-encrypted · owner-only</span
							>
						{/if}
					</div>
				{/if}
				{#if proofPending[m.market_object_id] && !proofRef[m.market_object_id] && !sealRef[m.market_object_id]}
					<p class="mt-1 text-[11px] text-ink-subdued">🔒 Generating verifiable proof on Walrus…</p>
				{/if}
			</div>
		{:else if analyzing === m.market_object_id || streamReasoning[m.market_object_id]}
			<!-- Live streaming reasoning (ChatGPT-style typewriter). -->
			<div class="mt-2 bg-primary-subtle/40 p-2 text-xs">
				<p class="font-semibold text-primary-deep">
					{#if stage[m.market_object_id] === 'proof'}
						🔒 <span class="ai-dots">Generating proof</span>
					{:else}
						🤖 <span class="ai-dots">Reasoning</span>
					{/if}
				</p>
				{#if streamReasoning[m.market_object_id]}
					<p class="mt-1 whitespace-pre-line text-ink-muted">
						{streamReasoning[m.market_object_id]}<span
							class="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-ink-muted align-middle"
						></span>
					</p>
				{/if}
			</div>
		{:else if walletAddress && (sealRef[m.market_object_id] || proofRef[m.market_object_id])}
			<!-- Owned analysis from a previous session — public proof + owner-only decrypt. -->
			<div class="relative z-10 mt-2 flex flex-col gap-1.5 bg-primary-subtle/40 p-2 text-xs">
				<div class="flex items-center justify-between gap-2">
					<span class="truncate text-ink-muted">🔒 You own an analysis for this market</span>
					{#if sealRef[m.market_object_id]}
						<Button
							size="sm"
							variant="outline"
							class="h-7 shrink-0"
							onclick={() => decrypt(m)}
							disabled={decrypting === m.market_object_id}
						>
							{decrypting === m.market_object_id ? 'Decrypting…' : 'Decrypt to view'}
						</Button>
					{/if}
				</div>
				{#if proofRef[m.market_object_id]}
					<ProofBadge publicBlobId={proofRef[m.market_object_id]} />
				{/if}
			</div>
		{/if}

		{#if myPos.length > 0}
			<div class="relative z-10 mt-3 space-y-1 pt-2">
				{#each myPos as p (p.id)}
					{@const pv = positionValue(p.amount, p.outcome, m.pools, m.total)}
					{@const won = m.winner !== null && p.outcome === m.winner}
					<div class="flex items-center justify-between gap-2 text-xs">
						<span class="min-w-0 truncate text-ink-muted">
							{fmt(p.amount)} on {OUTCOME_LABEL[p.outcome]}
							{#if !resolved}
								· if it wins <span class="font-medium text-ink">{fmt(pv.payout)}</span>
								<span class={pv.pnl >= 0 ? 'text-success' : 'text-error'}>
									({pv.pnl >= 0 ? '+' : ''}{(pv.roi * 100).toFixed(0)}%)
								</span>
							{:else if won}
								· won <span class="font-medium text-success">{fmt(pv.payout)}</span>
							{:else}
								· <span class="text-error">lost</span>
							{/if}
						</span>
						{#if resolved}
							{#if won}
								<Button size="sm" class="shrink-0" onclick={() => onClaim(m, p)}>Claim</Button>
							{:else}
								<Button size="sm" variant="ghost" class="shrink-0 text-ink-subdued" disabled>
									Lost
								</Button>
							{/if}
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet sectionHead(label: string, count: number, isLive = false)}
	<div class="mb-2 flex items-center gap-2">
		{#if isLive}
			<span class="h-2 w-2 animate-pulse rounded-full bg-error"></span>
		{/if}
		<h3 class="text-sm font-semibold text-ink">{label}</h3>
		<span class="text-xs text-ink-subdued">{count}</span>
	</div>
{/snippet}

{#snippet content()}
	{#if loading && markets.length === 0}
		<div class="space-y-3">
			{#each [1, 2] as _i (_i)}
				<div class="h-28 animate-pulse border border-border bg-muted"></div>
			{/each}
		</div>
	{:else if currentCount === 0}
		<p class="py-8 text-center text-sm text-ink-muted">No markets in this category</p>
	{:else if currentCategory === 'live'}
		<!-- Live bundles Live + Starting Soon -->
		<div class="space-y-5">
			{#if live.length}
				<div>
					{@render sectionHead('Live', live.length, true)}
					<div class="space-y-3">
						{#each live as m (m.market_object_id)}
							{@render marketCard(m)}
						{/each}
					</div>
				</div>
			{/if}
			{#if soon.length}
				<div>
					{@render sectionHead('Starting Soon', soon.length)}
					<div class="space-y-3">
						{#each soon as m (m.market_object_id)}
							{@render marketCard(m)}
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{:else if currentCategory === 'upcoming'}
		<div class="space-y-5">
			{#each dayGroups as group (group.label)}
				<div>
					<h4 class="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
						{group.label}
					</h4>
					<div class="space-y-3">
						{#each group.items as m (m.market_object_id)}
							{@render marketCard(m)}
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{:else}
		<div class="space-y-3">
			{#each resolved as m (m.market_object_id)}
				{@render marketCard(m)}
			{/each}
		</div>
	{/if}
{/snippet}

<section class="p-5">
	<div class="md:flex md:gap-6">
		<!-- Filters: left sidebar on desktop, stacked at the top on mobile -->
		<aside class="mb-4 md:mb-0 md:w-48 md:shrink-0 md:border-r md:border-border md:pr-4">
			<!-- Event switcher: horizontal on mobile, vertical on desktop -->
			<div class="flex flex-row flex-wrap gap-x-4 gap-y-1 text-sm md:flex-col md:gap-1">
				{#each categories as cat (cat.key)}
					<button
						type="button"
						onclick={() => (category = cat.key)}
						class="flex items-center gap-1.5 font-medium transition-colors {currentCategory ===
						cat.key
							? 'text-primary'
							: 'text-ink-muted hover:text-ink'}"
					>
						{#if cat.key === 'live' && cat.count > 0}
							<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-error"></span>
						{/if}
						{cat.label}
						<span class="text-xs text-ink-subdued">{cat.count}</span>
					</button>
				{/each}
			</div>

			<!-- Desktop: nested Sport → League tree -->
			<div class="mt-3 hidden md:block">
				<Separator class="mb-2" />
				<p class="mb-1 px-1 text-[11px] font-semibold tracking-wide text-ink-subdued uppercase">
					Sports
				</p>
				<button
					type="button"
					onclick={clearSport}
					class="block w-full px-1 py-1 text-left text-sm transition-colors {allSports
						? 'font-semibold text-primary'
						: 'text-ink-muted hover:text-ink'}"
				>
					All sports
				</button>
				{#each SPORT_CATEGORIES as c (c.sport)}
					{@const sportTotal = sportCounts.bySport[c.sport] ?? 0}
					<details open={openSport === c.sport}>
						<summary
							onclick={(e) => toggleSport(e, c.sport)}
							class="flex cursor-pointer list-none items-center justify-between px-1 py-1 text-sm select-none marker:content-none hover:text-ink [&::-webkit-details-marker]:hidden {sportTotal
								? 'text-ink'
								: 'text-ink-subdued'}"
						>
							<span class="flex items-center gap-1.5">
								<span aria-hidden="true">{c.emoji}</span>{c.label}
								{#if sportTotal}<span class="text-xs text-ink-subdued">{sportTotal}</span>{/if}
							</span>
							<ChevronDown
								class="h-3.5 w-3.5 text-ink-subdued transition-transform {openSport === c.sport
									? 'rotate-180'
									: ''}"
							/>
						</summary>
						<div class="flex flex-col">
							<button
								type="button"
								onclick={() => selectSport(c.sport)}
								class="px-1 py-1 pl-7 text-left text-xs transition-colors {sportFilter ===
									c.sport && !leagueFilter
									? 'font-semibold text-primary'
									: 'text-ink-muted hover:text-ink'}"
							>
								All {c.label}
							</button>
							{#each c.leagues as lg (lg.slug)}
								{@const n = sportCounts.byLeague[lg.slug] ?? 0}
								<button
									type="button"
									onclick={() => selectLeague(c.sport, lg.slug)}
									class="flex items-center justify-between px-1 py-1 pl-7 text-left text-xs transition-colors {leagueFilter ===
									lg.slug
										? 'font-semibold text-primary'
										: n
											? 'text-ink-muted hover:text-ink'
											: 'text-ink-subdued'}"
								>
									<span>{lg.label}</span>
									{#if n}<span class="text-[11px] text-ink-subdued">{n}</span>{/if}
								</button>
							{/each}
						</div>
					</details>
				{/each}
			</div>

			<!-- Mobile: nested Sport dropdown -->
			<div class="mt-3 md:hidden">
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="outline" size="sm" class="w-full justify-between gap-2">
								<span class="truncate">{currentSportLabel}</span>
								<ChevronDown class="h-4 w-4 shrink-0 opacity-60" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="w-56" align="start">
						<DropdownMenu.Item onSelect={clearSport}>All sports</DropdownMenu.Item>
						<DropdownMenu.Separator />
						{#each SPORT_CATEGORIES as c (c.sport)}
							<DropdownMenu.Sub>
								<DropdownMenu.SubTrigger>
									<span class="mr-2" aria-hidden="true">{c.emoji}</span>{c.label}
								</DropdownMenu.SubTrigger>
								<DropdownMenu.SubContent class="w-52">
									<DropdownMenu.Item onSelect={() => selectSport(c.sport)}>
										All {c.label}
									</DropdownMenu.Item>
									<DropdownMenu.Separator />
									{#each c.leagues as lg (lg.slug)}
										<DropdownMenu.Item onSelect={() => selectLeague(c.sport, lg.slug)}>
											{lg.label}
										</DropdownMenu.Item>
									{/each}
								</DropdownMenu.SubContent>
							</DropdownMenu.Sub>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</aside>

		<!-- Market list -->
		<div class="min-w-0 flex-1">
			{@render content()}
		</div>
	</div>
</section>
