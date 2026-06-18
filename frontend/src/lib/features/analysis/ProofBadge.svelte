<script lang="ts">
	import { ExternalLink, ShieldCheck, ShieldAlert, Loader } from '@lucide/svelte';
	import { getPublicProof, walrusBlobUrl } from './analysis';

	let { publicBlobId }: { publicBlobId: string } = $props();

	let status = $state<'loading' | 'verified' | 'unverified' | 'error'>('loading');

	// Fetch the public proof from Walrus and verify its content hash (no wallet needed).
	$effect(() => {
		const id = publicBlobId;
		status = 'loading';
		getPublicProof(id)
			.then((r) => {
				status = r.verified ? 'verified' : 'unverified';
			})
			.catch(() => {
				status = 'error';
			});
	});
</script>

<div class="flex items-center gap-1 text-[10px]">
	{#if status === 'loading'}
		<Loader class="h-3 w-3 animate-spin text-ink-subdued" />
		<span class="text-ink-subdued">Verifying proof on Walrus…</span>
	{:else if status === 'error'}
		<span class="text-ink-subdued">Proof unavailable</span>
	{:else}
		{#if status === 'verified'}
			<ShieldCheck class="h-3 w-3 text-success" />
		{:else}
			<ShieldAlert class="h-3 w-3 text-error" />
		{/if}
		<a
			href={walrusBlobUrl(publicBlobId)}
			target="_blank"
			rel="noopener noreferrer"
			class="inline-flex items-center gap-0.5 text-ink-muted hover:text-ink hover:underline"
			title="Open the public, hash-verified proof bundle on Walrus"
		>
			{status === 'verified' ? 'Verified proof on Walrus' : 'Proof on Walrus (unverified)'}
			<ExternalLink class="h-2.5 w-2.5" />
		</a>
	{/if}
</div>
