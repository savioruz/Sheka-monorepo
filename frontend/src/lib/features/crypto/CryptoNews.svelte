<script lang="ts">
	import { onMount } from 'svelte';
	import { ExternalLink } from '@lucide/svelte';
	import { getCryptoNews, type CryptoNewsItem } from './api';

	let { limit = 12 }: { limit?: number } = $props();

	let articles = $state<CryptoNewsItem[]>([]);
	let loading = $state(true);

	onMount(async () => {
		try {
			articles = (await getCryptoNews(limit)).articles;
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

	{#if loading && articles.length === 0}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
			{#each [1, 2, 3, 4] as _i (_i)}
				<div class="h-24 animate-pulse border border-border bg-muted"></div>
			{/each}
		</div>
	{:else if articles.length === 0}
		<p class="py-8 text-center text-sm text-ink-muted">No crypto news right now.</p>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
			{#each articles as a (a.link)}
				<a
					href={a.link}
					target="_blank"
					rel="noopener noreferrer"
					class="flex gap-3 border border-border bg-card p-3 shadow-card transition-colors [contain-intrinsic-size:auto_88px] [content-visibility:auto] hover:border-ring"
				>
					{#if a.image}
						<img
							src={a.image}
							alt=""
							width="96"
							height="64"
							loading="lazy"
							decoding="async"
							class="h-16 w-24 shrink-0 object-cover"
							onerror={hideImg}
						/>
					{/if}
					<div class="min-w-0">
						<p class="line-clamp-2 text-sm font-semibold text-ink">{a.title}</p>
						{#if a.description}
							<p class="mt-0.5 line-clamp-2 text-xs text-ink-muted">{a.description}</p>
						{/if}
						<p class="mt-1 inline-flex items-center gap-1 text-[11px] text-ink-subdued">
							{a.source}
							{#if a.published}· {fmtDate(a.published)}{/if}
							<ExternalLink class="h-2.5 w-2.5" />
						</p>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</section>
