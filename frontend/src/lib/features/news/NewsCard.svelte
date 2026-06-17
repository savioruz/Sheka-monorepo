<script lang="ts">
	import { leagueLabel } from '$lib/utils';

	// Minimal shape shared by the home feed (NewsItem) and market-detail (NewsArticle).
	type Article = {
		id: number | null;
		headline: string;
		description?: string | null;
		published: string | null;
		thumbnail: string | null;
		league?: string | null;
	};

	let { article }: { article: Article } = $props();

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

<!--
	`content-visibility: auto` lets the browser skip layout/paint for off-screen
	cards and reclaim their decoded thumbnails — key for low-end devices. The
	intrinsic-size hint keeps the scrollbar stable while cards are unrendered.
-->
<a
	href={article.id ? `/news/${article.id}` : undefined}
	class="flex gap-3 border border-border bg-card p-3 shadow-card transition-colors [contain-intrinsic-size:auto_88px] [content-visibility:auto] hover:border-ring"
>
	{#if article.thumbnail}
		<img
			src={article.thumbnail}
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
		<p class="line-clamp-2 text-sm font-semibold text-ink">{article.headline}</p>
		{#if article.description}
			<p class="mt-0.5 line-clamp-2 text-xs text-ink-muted">{article.description}</p>
		{/if}
		<p class="mt-1 text-[11px] text-ink-subdued">
			{#if article.league}{leagueLabel(article.league)} ·
			{/if}{fmtDate(article.published)}
		</p>
	</div>
</a>
