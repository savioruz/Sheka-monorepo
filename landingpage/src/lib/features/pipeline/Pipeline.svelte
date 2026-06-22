<script lang="ts">
	import { Target, BrainCircuit, Wallet, Lock } from '@lucide/svelte';

	type Step = { icon: typeof Target; title: string; body?: string; mono?: string };

	const steps: Step[] = [
		{
			icon: Target,
			title: '1. Pick a Market',
			body: 'Select from live sports events or on-chain crypto price movements.'
		},
		{
			icon: BrainCircuit,
			title: '2. AI Analyzes Live',
			body: 'Our models process real-time data to calculate probabilities instantly.'
		},
		{
			icon: Wallet,
			title: '3. Self-Custody',
			body: 'Place your position securely. Your funds never leave your control.'
		},
		{ icon: Lock, title: '4. Proof is Sealed', mono: 'tx_hash: 0x8f...3a9c' }
	];
</script>

<section class="flex w-full flex-col gap-stack-lg">
	<div class="mb-4 text-center">
		<h2 class="text-headline-lg-mobile text-ink md:text-headline-lg">The Execution Pipeline</h2>
	</div>
	<div class="grid grid-cols-1 gap-stack-md md:grid-cols-4">
		{#each steps as step (step.title)}
			{@const Icon = step.icon}
			<div
				class="group rounded-2xl border border-border bg-surface-1 p-6 transition-colors hover:bg-card"
			>
				<div
					class="group-hover:glow-effect mb-6 flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 transition-shadow"
				>
					<Icon class="size-6 text-primary" />
				</div>
				<h3 class="mb-2 text-headline-md text-ink">{step.title}</h3>
				{#if step.mono}
					<p class="mt-2 font-mono text-data-sm text-primary-deep">{step.mono}</p>
				{:else}
					<p class="text-body-sm text-ink-muted">{step.body}</p>
				{/if}
			</div>
		{/each}
	</div>
</section>
