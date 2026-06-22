<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { initAuthStore, setupEnoki, clearAuth } from '$lib/features/wallet';
	import { setUnauthorizedHandler } from '$lib/api';
	import { suiClient } from '$lib/sui';
	import { refreshClaimable, clearClaimable } from '$lib/features/claims';
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

	// On connect, load claimable winnings (feeds the navbar "Claim N" badge) and
	// nudge the user once per browser session if they have any.
	const address = $derived($auth.address);
	let checkedFor = $state<string | null>(null);
	$effect(() => {
		const addr = address;
		if (!addr) {
			clearClaimable();
			checkedFor = null;
			return;
		}
		if (checkedFor === addr) return;
		checkedFor = addr;
		void refreshClaimable(addr, suiClient).then((items) => {
			if (items.length > 0 && !nudged()) {
				markNudged();
				toast.success(`You won ${items.length} position${items.length > 1 ? 's' : ''}`, {
					description: 'Claim your payout.',
					action: { label: 'Claim', onClick: () => goto('/claim') }
				});
			}
		});
	});

	function nudged(): boolean {
		try {
			return sessionStorage.getItem('sheka_claim_nudged') === '1';
		} catch {
			return false;
		}
	}
	function markNudged(): void {
		try {
			sessionStorage.setItem('sheka_claim_nudged', '1');
		} catch {
			/* no storage — best effort */
		}
	}

	const meta = $derived((page.data?.meta ?? {}) as PageMeta);
</script>

<SEO {...meta} />
<div class="min-h-screen bg-background">
	<Navbar />
	{@render children()}
</div>
<Toaster position="bottom-right" richColors closeButton />
