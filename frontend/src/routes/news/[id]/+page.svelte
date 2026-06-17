<script lang="ts">
	import { ExternalLink } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb';
	import { leagueLabel } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const a = $derived(data.article);

	// Link the league crumb to the news list filtered by that league.
	const leagueHref = $derived.by(() => {
		if (!a.league) return '/news';
		const parts: string[] = [];
		if (a.sport) parts.push(`sport=${encodeURIComponent(a.sport)}`);
		parts.push(`league=${encodeURIComponent(a.league)}`);
		return `/news?${parts.join('&')}`;
	});

	function hideImg(e: Event) {
		(e.currentTarget as HTMLImageElement).style.display = 'none';
	}

	function fmtDate(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<article class="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
	<Breadcrumb.Root class="mb-4">
		<Breadcrumb.List>
			<Breadcrumb.Item>
				<Breadcrumb.Link href="/">Home</Breadcrumb.Link>
			</Breadcrumb.Item>
			<Breadcrumb.Separator />
			<Breadcrumb.Item>
				<Breadcrumb.Link href="/#News">News</Breadcrumb.Link>
			</Breadcrumb.Item>
			{#if a.league}
				<Breadcrumb.Separator />
				<Breadcrumb.Item>
					<Breadcrumb.Link href={leagueHref}>{leagueLabel(a.league)}</Breadcrumb.Link>
				</Breadcrumb.Item>
			{/if}
			<Breadcrumb.Separator />
			<Breadcrumb.Item>
				<Breadcrumb.Page class="line-clamp-1 max-w-[60vw]">{a.headline}</Breadcrumb.Page>
			</Breadcrumb.Item>
		</Breadcrumb.List>
	</Breadcrumb.Root>

	<p class="text-xs text-ink-subdued">{fmtDate(a.published)}</p>
	<h1 class="mt-1 text-xl font-bold text-ink sm:text-2xl">{a.headline}</h1>

	{#if a.image}
		<img
			src={a.image}
			alt=""
			decoding="async"
			class="mt-4 w-full rounded-lg border border-border object-cover"
			onerror={hideImg}
		/>
	{/if}

	{#if a.description}
		<p class="mt-4 leading-relaxed text-ink-muted">{a.description}</p>
	{/if}

	{#if a.url}
		<div class="mt-6">
			<Button href={a.url} target="_blank" rel="noopener noreferrer">
				Read full story on ESPN <ExternalLink class="ml-1 h-4 w-4" />
			</Button>
		</div>
	{/if}
</article>
