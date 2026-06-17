<script lang="ts">
	import { onMount } from 'svelte';
	import { ArrowRight } from '@lucide/svelte';
	import { getNews, type NewsItem } from './api';
	import NewsCard from './NewsCard.svelte';

	// Home preview: a fixed handful of the latest articles. Full browsing +
	// search + pagination lives on /news (cheaper for low-end devices than an
	// ever-growing infinite-scroll list).
	let { limit = 8 }: { limit?: number } = $props();

	let articles = $state<NewsItem[]>([]);
	let loading = $state(true);

	onMount(async () => {
		try {
			articles = (await getNews(0, limit)).articles;
		} catch {
			/* keep empty on failure */
		}
		loading = false;
	});
</script>

<section id="News" class="scroll-mt-20 p-5">
	<div class="mb-3 flex items-center justify-between">
		<h2 class="text-base font-semibold text-ink">Latest News</h2>
		<a
			href="/news"
			class="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline"
		>
			View all <ArrowRight class="h-3.5 w-3.5" />
		</a>
	</div>

	{#if loading}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
			{#each [1, 2, 3, 4] as _i (_i)}
				<div class="h-24 animate-pulse border border-border bg-muted"></div>
			{/each}
		</div>
	{:else if articles.length === 0}
		<p class="py-8 text-center text-sm text-ink-muted">No news right now.</p>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
			{#each articles as a (a.id ?? a.headline)}
				<NewsCard article={a} />
			{/each}
		</div>
	{/if}
</section>
