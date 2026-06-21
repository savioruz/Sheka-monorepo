<script lang="ts">
	import { onMount } from 'svelte';
	import { getProofFeed, ProofBadge, type ProofFeedItem } from '$lib/features/analysis';
	import { ShieldCheck } from '@lucide/svelte';

	let analyses = $state<ProofFeedItem[]>([]);
	let loading = $state(true);
	let failed = $state(false);

	onMount(async () => {
		try {
			analyses = (await getProofFeed(50)).analyses;
		} catch {
			failed = true;
		}
		loading = false;
	});

	function shortId(id: string | null): string {
		if (!id) return '—';
		return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id;
	}
	function suiscanObject(id: string | null): string {
		return id ? `https://suiscan.xyz/testnet/object/${id}` : '#';
	}
	function fmtTime(iso: string): string {
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
	}
</script>

<svelte:head>
	<title>Verifiable AI memory · Sheka</title>
</svelte:head>

<main class="mx-auto max-w-4xl px-4 py-8 sm:px-6">
	<header class="mb-5">
		<h1 class="flex items-center gap-2 text-xl font-bold text-ink">
			<ShieldCheck class="h-5 w-5 text-success" /> Verifiable AI memory on Walrus
		</h1>
		<p class="mt-1 text-sm text-ink-muted">
			Every AI analysis Sheka produces is archived on <span class="font-medium">Walrus</span> as a public,
			hash-verifiable proof (and a Seal-encrypted owner-only copy). This is the auditable, accumulating
			record of AI decisions — each row re-fetches its blob from Walrus and recomputes the SHA-256 live.
			No wallet needed.
		</p>
	</header>

	{#if loading}
		<div class="space-y-2">
			{#each [1, 2, 3, 4, 5] as _i (_i)}
				<div class="h-16 animate-pulse border border-border bg-muted"></div>
			{/each}
		</div>
	{:else if failed}
		<p class="py-10 text-center text-sm text-ink-muted">Couldn't load the proof ledger.</p>
	{:else if analyses.length === 0}
		<p class="py-10 text-center text-sm text-ink-muted">No analyses yet.</p>
	{:else}
		<ul class="space-y-2">
			{#each analyses as a (a.public_blob_id)}
				<li
					class="flex flex-col gap-2 border border-border bg-card p-3 shadow-card sm:flex-row sm:items-center sm:justify-between"
				>
					<div class="min-w-0">
						<p class="text-sm font-medium text-ink">
							<a
								href={suiscanObject(a.market_id)}
								target="_blank"
								rel="noopener noreferrer"
								class="font-mono text-ink hover:text-primary"
							>
								{shortId(a.market_id)}
							</a>
							<span class="text-ink-subdued">· {a.model_label ?? `model ${a.model_id}`}</span>
						</p>
						<p class="text-[11px] text-ink-subdued">{fmtTime(a.created_at)}</p>
					</div>
					<div class="shrink-0">
						<ProofBadge publicBlobId={a.public_blob_id} />
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</main>
