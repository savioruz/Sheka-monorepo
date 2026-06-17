<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { initAuthStore, setupEnoki } from '$lib/features/wallet';
	import SEO from '$lib/components/generic/SEO.svelte';
	import type { PageMeta } from '$lib/metadata';
	import { Toaster } from 'svelte-sonner';

	let { children } = $props();

	initAuthStore();
	// Register the Enoki "Sign in with Google" wallet (browser-only; no-op if unconfigured).
	onMount(() => setupEnoki());

	const meta = $derived((page.data?.meta ?? {}) as PageMeta);
</script>

<SEO {...meta} />
{@render children()}
<Toaster position="bottom-right" richColors closeButton />
