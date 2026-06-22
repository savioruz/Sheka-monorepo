<script lang="ts">
	import { Construction } from '@lucide/svelte';
</script>

<section
	class="flex min-h-[60vh] flex-col items-center justify-center gap-stack-md px-margin-mobile text-center"
>
	<div
		class="glow-effect mb-2 flex size-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10"
	>
		<Construction class="size-8 text-primary" />
	</div>
	<h1 class="text-display-lg text-ink">Under construction</h1>
	<p class="max-w-md text-body-lg text-ink-muted">
		This page isn't ready yet — we're still building it. Check back soon.
	</p>
	<a
		href="/"
		class="glow-effect mt-2 inline-block rounded bg-primary px-8 py-3 text-headline-md text-white transition-colors hover:bg-primary-deep"
	>
		Back to home
	</a>
</section>
