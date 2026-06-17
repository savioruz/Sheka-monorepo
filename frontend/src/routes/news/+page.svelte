<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { Search, ChevronDown } from '@lucide/svelte';
	import { NewsCard, NEWS_CATEGORIES } from '$lib/features/news';
	import { Button } from '$lib/components/ui/button';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Pagination from '$lib/components/ui/pagination';
	import { leagueLabel, sportEmoji, titleCaseSport } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Local input value, seeded once from the URL. Debounced changes navigate
	// (which re-runs `load`), so the list + pagination stay driven by the URL.
	let query = $state(untrack(() => data.q));
	let debounce: ReturnType<typeof setTimeout> | undefined;

	// Label for the current category selection (shown on the dropdown trigger).
	// Falls back to the shared label maps for leagues/sports not in the curated
	// tree (e.g. when arriving from a news-detail breadcrumb link).
	const currentCategory = $derived.by(() => {
		if (data.league) {
			for (const c of NEWS_CATEGORIES) {
				const lg = c.leagues.find((l) => l.slug === data.league);
				if (lg) return `${c.emoji} ${lg.label}`;
			}
			return `${data.sport ? sportEmoji(data.sport) : ''} ${leagueLabel(data.league)}`.trim();
		}
		if (data.sport) {
			const c = NEWS_CATEGORIES.find((x) => x.sport === data.sport);
			if (c) return `${c.emoji} ${c.label}`;
			return `${sportEmoji(data.sport)} ${titleCaseSport(data.sport)}`;
		}
		return 'All news';
	});

	function navigate(next: {
		q?: string;
		sport?: string | null;
		league?: string | null;
		page?: number;
		replace?: boolean;
	}) {
		const q = (next.q ?? data.q).trim();
		const sport = next.sport === undefined ? data.sport : (next.sport ?? '');
		const league = next.league === undefined ? data.league : (next.league ?? '');
		const page = next.page ?? 1; // any filter change resets to page 1
		const parts: string[] = [];
		if (q) parts.push(`q=${encodeURIComponent(q)}`);
		if (sport) parts.push(`sport=${encodeURIComponent(sport)}`);
		if (league) parts.push(`league=${encodeURIComponent(league)}`);
		if (page > 1) parts.push(`page=${page}`);
		const qs = parts.join('&');
		void goto(`/news${qs ? `?${qs}` : ''}`, {
			replaceState: next.replace ?? false,
			keepFocus: true,
			noScroll: next.replace ?? false
		});
	}

	function onSearchInput() {
		clearTimeout(debounce);
		// Debounce ~300ms; reset to page 1; replace history so typing doesn't spam it.
		debounce = setTimeout(() => navigate({ q: query, page: 1, replace: true }), 300);
	}
</script>

<div class="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
	<Breadcrumb.Root class="mb-4">
		<Breadcrumb.List>
			<Breadcrumb.Item>
				<Breadcrumb.Link href="/">Home</Breadcrumb.Link>
			</Breadcrumb.Item>
			<Breadcrumb.Separator />
			<Breadcrumb.Item>
				<Breadcrumb.Page>News</Breadcrumb.Page>
			</Breadcrumb.Item>
		</Breadcrumb.List>
	</Breadcrumb.Root>

	<!-- Category dropdown (left, max 1/2) + search (1/4, right) with space between -->
	<div class="mb-5 flex w-full items-center justify-between gap-3">
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" class="max-w-[50%] justify-between gap-2">
						<span class="flex min-w-0 items-center gap-1.5">
							<span class="text-ink-subdued">Category:</span>
							<span class="truncate font-medium">{currentCategory}</span>
						</span>
						<ChevronDown class="h-4 w-4 shrink-0 opacity-60" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content class="w-56" align="start">
				<DropdownMenu.Item onSelect={() => navigate({ sport: null, league: null })}>
					All news
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				{#each NEWS_CATEGORIES as c (c.sport)}
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger>
							<span class="mr-2" aria-hidden="true">{c.emoji}</span>{c.label}
						</DropdownMenu.SubTrigger>
						<DropdownMenu.SubContent class="w-52">
							<DropdownMenu.Item onSelect={() => navigate({ sport: c.sport, league: null })}>
								All {c.label}
							</DropdownMenu.Item>
							<DropdownMenu.Separator />
							{#each c.leagues as lg (lg.slug)}
								<DropdownMenu.Item onSelect={() => navigate({ sport: c.sport, league: lg.slug })}>
									{lg.label}
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.SubContent>
					</DropdownMenu.Sub>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		<div class="relative w-1/2 shrink-0">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-subdued"
			/>
			<input
				type="search"
				placeholder="Search news…"
				bind:value={query}
				oninput={onSearchInput}
				class="w-full rounded-md border border-border bg-card py-2 pr-3 pl-9 text-sm text-ink placeholder:text-ink-subdued focus:border-ring focus:outline-none"
			/>
		</div>
	</div>

	{#if data.articles.length === 0}
		<p class="py-16 text-center text-sm text-ink-muted">
			{data.q ? `No news found for “${data.q}”.` : 'No news for this category right now.'}
		</p>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each data.articles as a (a.id ?? a.headline)}
				<NewsCard article={a} />
			{/each}
		</div>

		{#if data.total > data.perPage}
			<Pagination.Root
				count={data.total}
				perPage={data.perPage}
				page={data.page}
				onPageChange={(p) => navigate({ page: p })}
				class="mt-6"
			>
				{#snippet children({ pages, currentPage })}
					<Pagination.Content>
						<Pagination.Item>
							<Pagination.PrevButton />
						</Pagination.Item>
						{#each pages as p (p.key)}
							{#if p.type === 'ellipsis'}
								<Pagination.Item>
									<Pagination.Ellipsis />
								</Pagination.Item>
							{:else}
								<Pagination.Item>
									<Pagination.Link page={p} isActive={currentPage === p.value}>
										{p.value}
									</Pagination.Link>
								</Pagination.Item>
							{/if}
						{/each}
						<Pagination.Item>
							<Pagination.NextButton />
						</Pagination.Item>
					</Pagination.Content>
				{/snippet}
			</Pagination.Root>
		{/if}
	{/if}
</div>
