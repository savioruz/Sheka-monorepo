<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs';
	import { ArrowLeft } from '@lucide/svelte';
	import { leagueLabel } from '$lib/utils';
	import { formatStartChip, liveLabel, OUTCOME_LABEL } from '$lib/features/markets';
	import { formatBalance } from '$lib/sui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const m = $derived(data.market);

	// Static snapshot is fine on a detail page (no live countdown needed).
	const now = Date.now();

	function hideImg(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}

	function fmtPool(units: number): string {
		return formatBalance(BigInt(Math.round(units)), 6);
	}

	function fmtDate(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<div class="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
	<a
		href="/"
		class="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted transition-colors hover:text-ink"
	>
		<ArrowLeft class="h-4 w-4" /> Back to markets
	</a>

	<header class="mb-5">
		<p class="text-xs text-ink-subdued">{leagueLabel(m.league)}</p>
		<h1 class="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold text-ink sm:text-2xl">
			{#if m.home_logo}
				<img src={m.home_logo} alt="" class="h-6 w-6 object-contain" onerror={hideImg} />
			{/if}
			{m.home}
			<span class="text-ink-subdued">vs</span>
			{#if m.away_logo}
				<img src={m.away_logo} alt="" class="h-6 w-6 object-contain" onerror={hideImg} />
			{/if}
			{m.away}
		</h1>
		<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
			{#if m.status === 'resolved'}
				<span class="font-semibold text-success">
					Settled · {OUTCOME_LABEL[m.winner ?? 0]} won
				</span>
			{:else if liveLabel(m)}
				<span class="flex items-center gap-1 font-semibold text-error">
					<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-error"></span>{liveLabel(m)}
				</span>
			{:else}
				<span>{formatStartChip(m.scheduled_at, now)}</span>
			{/if}
			<span>Pool {fmtPool(m.total)} DUSDC</span>
			<span class="font-mono">
				{m.implied_odds[0]}% / {m.implied_odds[1]}% / {m.implied_odds[2]}%
			</span>
		</div>
	</header>

	<Tabs.Root value="news" class="w-full">
		<Tabs.List class="w-full justify-start overflow-x-auto">
			<Tabs.Trigger value="news">News</Tabs.Trigger>
			<Tabs.Trigger value="lineups" disabled>Lineups</Tabs.Trigger>
			<Tabs.Trigger value="prediction" disabled>Prediction</Tabs.Trigger>
			<Tabs.Trigger value="stats" disabled>Stats</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="news" class="pt-4">
			{#if data.articles.length === 0}
				<p class="py-10 text-center text-sm text-ink-muted">No recent news for this match.</p>
			{:else}
				<ul class="space-y-4">
					{#each data.articles as a (a.headline)}
						<li class="flex gap-3">
							{#if a.thumbnail}
								<img
									src={a.thumbnail}
									alt=""
									class="h-16 w-24 shrink-0 object-cover"
									onerror={hideImg}
								/>
							{/if}
							<div class="min-w-0">
								<p class="font-semibold text-ink">{a.headline}</p>
								{#if a.description}
									<p class="mt-0.5 text-sm text-ink-muted">{a.description}</p>
								{/if}
								{#if a.published}
									<p class="mt-1 text-xs text-ink-subdued">{fmtDate(a.published)}</p>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</Tabs.Content>
	</Tabs.Root>
</div>
