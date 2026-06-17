<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs';
	import { leagueLabel } from '$lib/utils';
	import { formatStartChip, liveLabel, OUTCOME_LABEL } from '$lib/features/markets';
	import { NewsCard } from '$lib/features/news';
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
</script>

<div class="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
	<header class="mb-5">
		<p class="text-xs text-ink-subdued">{leagueLabel(m.league)}</p>
		<h1 class="mt-1 flex flex-wrap items-center gap-2 text-xl font-bold text-ink sm:text-2xl">
			{#if m.home_logo}
				<img
					src={m.home_logo}
					alt=""
					width="24"
					height="24"
					decoding="async"
					class="h-6 w-6 object-contain"
					onerror={hideImg}
				/>
			{/if}
			{m.home}
			<span class="text-ink-subdued">vs</span>
			{#if m.away_logo}
				<img
					src={m.away_logo}
					alt=""
					width="24"
					height="24"
					decoding="async"
					class="h-6 w-6 object-contain"
					onerror={hideImg}
				/>
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
				<div class="grid gap-3">
					{#each data.articles as a (a.id ?? a.headline)}
						<NewsCard article={a} />
					{/each}
				</div>
			{/if}
		</Tabs.Content>
	</Tabs.Root>
</div>
