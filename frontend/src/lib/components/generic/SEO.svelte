<script lang="ts">
	import { page } from '$app/state';
	import { resolveMeta, type PageMeta } from '$lib/metadata';

	let props: PageMeta = $props();

	const m = $derived(resolveMeta(page.url.origin, page.url.href, props));
	const jsonLd = $derived(
		`<script type="application/ld+json">${JSON.stringify(m.jsonLd)}</` + `script>`
	);
</script>

<svelte:head>
	<title>{m.title}</title>
	<meta name="description" content={m.description} />
	<meta name="keywords" content={m.keywords} />
	<meta name="author" content={m.author} />
	<meta name="robots" content={m.robots} />
	<meta name="theme-color" content={m.themeColor} />
	<link rel="canonical" href={m.canonical} />

	<!-- Open Graph -->
	<meta property="og:title" content={m.title} />
	<meta property="og:description" content={m.description} />
	<meta property="og:type" content={m.type} />
	<meta property="og:url" content={m.canonical} />
	<meta property="og:site_name" content={m.siteName} />
	<meta property="og:locale" content={m.locale} />
	<meta property="og:image" content={m.image} />

	<!-- Twitter -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content={m.title} />
	<meta name="twitter:description" content={m.description} />
	<meta name="twitter:image" content={m.image} />
	{#if m.twitter}
		<meta name="twitter:creator" content={m.twitter} />
	{/if}

	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html jsonLd}
</svelte:head>
