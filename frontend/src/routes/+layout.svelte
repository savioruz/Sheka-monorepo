<script lang="ts">
	import './layout.css';
	import { page } from '$app/state';
	import { initAuthStore } from '$lib/features/wallet';
	import SEO from '$lib/components/generic/SEO.svelte';
	import type { PageMeta } from '$lib/metadata';
	import { Toaster } from 'svelte-sonner';

	let { children } = $props();

	initAuthStore();

	const meta = $derived((page.data?.meta ?? {}) as PageMeta);
</script>

<SEO {...meta} />
{@render children()}
<Toaster position="bottom-right" richColors closeButton />
