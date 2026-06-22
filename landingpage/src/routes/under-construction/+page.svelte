<script lang="ts">
	import { Header } from '$lib/features/header';
	import { UnderConstruction } from '$lib/features/under-construction';
	import SEO from '$lib/components/generic/SEO.svelte';
</script>

<SEO title="Under construction" noindex />

<Header />
<main
	class="relative z-10 mx-auto flex w-full max-w-7xl flex-grow flex-col px-margin-mobile pt-32 pb-16 md:px-gutter"
>
	<UnderConstruction />
</main>
