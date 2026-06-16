<script lang="ts">
	import { onMount } from 'svelte';
	import { getNews, type NewsItem } from './api';
	import { leagueLabel } from '$lib/utils';

	let { limit = 24 }: { limit?: number } = $props();

	let articles = $state<NewsItem[]>([]);
	let loading = $state(true);

	onMount(async () => {
		try {
			articles = (await getNews(limit)).articles;
		} catch {
			/* keep empty on failure */
		}
		loading = false;
	});

	function hideImg(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}

	function fmtDate(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<section class="p-5">
	<h2 class="mb-3 text-base font-semibold text-ink">Latest News</h2>

	{#if loading}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each [1, 2, 3, 4] as _i (_i)}
				<div class="h-24 animate-pulse border border-border bg-muted"></div>
			{/each}
		</div>
	{:else if articles.length === 0}
		<p class="py-8 text-center text-sm text-ink-muted">No news right now.</p>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each articles as a (a.headline)}
				<article class="flex gap-3 border border-border bg-card p-3 shadow-card">
					{#if a.thumbnail}
						<img
							src={a.thumbnail}
							alt=""
							class="h-16 w-24 shrink-0 object-cover"
							onerror={hideImg}
						/>
					{/if}
					<div class="min-w-0">
						<p class="line-clamp-2 text-sm font-semibold text-ink">{a.headline}</p>
						{#if a.description}
							<p class="mt-0.5 line-clamp-2 text-xs text-ink-muted">{a.description}</p>
						{/if}
						<p class="mt-1 text-[11px] text-ink-subdued">
							{#if a.league}{leagueLabel(a.league)} ·
							{/if}{fmtDate(a.published)}
						</p>
					</div>
				</article>
			{/each}
		</div>
	{/if}
</section>
