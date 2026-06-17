<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { initAuthStore, setupEnoki } from '$lib/features/wallet';
	import Navbar from '$lib/components/generic/Navbar.svelte';
	import SEO from '$lib/components/generic/SEO.svelte';
	import type { PageMeta } from '$lib/metadata';
	import { Toaster } from 'svelte-sonner';

	let { children } = $props();

	// Shared wallet/session state for the navbar + every page.
	initAuthStore();
	// Register the Enoki "Sign in with Google" wallet (browser-only; no-op if unconfigured).
	onMount(() => setupEnoki());

	const meta = $derived((page.data?.meta ?? {}) as PageMeta);
</script>

<SEO {...meta} />
<div class="min-h-screen bg-background">
	<Navbar />
	{@render children()}
</div>
<Toaster position="bottom-right" richColors closeButton />
