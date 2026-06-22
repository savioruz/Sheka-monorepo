<script lang="ts">
	import { WalletButton } from '$lib/features/wallet';
	import { claimable } from '$lib/features/claims';
	import { Badge } from '$lib/components/ui/badge';
</script>

<nav class="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur">
	<div
		class="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 sm:h-16 sm:px-6 lg:px-8"
	>
		<a href="/" class="flex shrink-0 items-center" aria-label="Sheka home">
			<img
				src="/logo.png"
				alt="Sheka"
				width="40"
				height="40"
				decoding="async"
				class="h-8 w-8 sm:h-10 sm:w-10"
			/>
			<span class="text-lg font-bold tracking-tight sm:text-xl">Sheka</span>
		</a>
		<div class="flex min-w-0 items-center gap-3 sm:gap-4">
			{#if $claimable.length > 0}
				<a href="/claim" class="shrink-0" aria-label="Claim winnings">
					<Badge variant="default">Claim {$claimable.length}</Badge>
				</a>
			{/if}
			<a
				href="/proofs"
				class="shrink-0 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
			>
				Proofs
			</a>
			<WalletButton />
		</div>
	</div>
</nav>
