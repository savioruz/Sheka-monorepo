<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { initAuthStore, setupEnoki, clearAuth } from '$lib/features/wallet';
	import { setUnauthorizedHandler } from '$lib/api';
	import Navbar from '$lib/components/generic/Navbar.svelte';
	import SEO from '$lib/components/generic/SEO.svelte';
	import type { PageMeta } from '$lib/metadata';
	import { toast, Toaster } from 'svelte-sonner';

	let { children } = $props();

	// Shared wallet/session state for the navbar + every page.
	const auth = initAuthStore();
	// On a 401 from any authed call, the session expired — clear it + prompt re-auth.
	setUnauthorizedHandler(() => {
		clearAuth(auth);
		toast.error('Session expired', { description: 'Please sign in again.' });
	});
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
