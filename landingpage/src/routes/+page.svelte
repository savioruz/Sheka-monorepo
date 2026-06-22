<script lang="ts">
	import { Header } from '$lib/features/header';
	import { Hero } from '$lib/features/hero';
	import { ProblemCard } from '$lib/features/problem';
	import { Pipeline } from '$lib/features/pipeline';
	import { Verifiable } from '$lib/features/verifiable';
	import { Products } from '$lib/features/products';
	import { HonestyStrip } from '$lib/features/honesty';
	import { FinalCta } from '$lib/features/finalcta';
	import { SiteFooter } from '$lib/features/footer';
	import SEO from '$lib/components/generic/SEO.svelte';
</script>

<SEO />

<Header />
<main
	class="relative z-10 mx-auto flex w-full max-w-7xl flex-grow flex-col gap-stack-xl px-margin-mobile pt-32 pb-16 md:px-gutter"
>
	<Hero />
	<ProblemCard />
	<Pipeline />
	<Verifiable />
	<Products />
	<HonestyStrip />
	<FinalCta />
</main>
<SiteFooter />
