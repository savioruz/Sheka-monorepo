<script lang="ts">
	import { Trophy, Bitcoin } from '@lucide/svelte';
</script>

<section class="flex w-full flex-col gap-stack-lg">
	<div class="mb-4 text-center">
		<h2 class="text-headline-lg-mobile text-ink md:text-headline-lg">Available Markets</h2>
	</div>
	<div class="grid grid-cols-1 gap-stack-lg md:grid-cols-2">
		<!-- Sports -->
		<div
			class="group relative overflow-hidden rounded-2xl border border-border bg-surface-1 p-stack-lg"
		>
			<div class="absolute top-0 right-0 p-6 opacity-5 transition-opacity group-hover:opacity-10">
				<Trophy class="size-32" />
			</div>
			<h3 class="relative z-10 mb-4 text-headline-md text-ink">Sports Markets</h3>
			<p class="relative z-10 mb-6 text-body-lg text-ink-muted">
				Predict game outcomes with dynamic odds powered by live data feeds.
			</p>
			<div class="relative z-10 flex gap-2">
				<span class="rounded-full bg-primary/10 px-3 py-1 font-mono text-data-sm text-primary-deep">
					Move Contracts
				</span>
				<span
					class="rounded-full border border-border bg-card px-3 py-1 font-mono text-data-sm text-ink-muted"
				>
					Parimutuel
				</span>
			</div>
		</div>
		<!-- Crypto -->
		<div
			class="group relative overflow-hidden rounded-2xl border border-border bg-surface-1 p-stack-lg"
		>
			<div class="absolute top-0 right-0 p-6 opacity-5 transition-opacity group-hover:opacity-10">
				<Bitcoin class="size-32" />
			</div>
			<h3 class="relative z-10 mb-4 text-headline-md text-ink">Crypto Markets</h3>
			<p class="relative z-10 mb-6 text-body-lg text-ink-muted">
				Short-term price action predictions with deep liquidity.
			</p>
			<div class="relative z-10 flex gap-2">
				<span class="rounded-full bg-primary/10 px-3 py-1 font-mono text-data-sm text-primary-deep">
					DeepBook Predict
				</span>
				<span
					class="rounded-full border border-border bg-card px-3 py-1 font-mono text-data-sm text-ink-muted"
				>
					BTC Up/Down
				</span>
			</div>
		</div>
	</div>
</section>
