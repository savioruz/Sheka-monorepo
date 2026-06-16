<script lang="ts">
	import { WalletButton } from '$lib/features/wallet';

	let { address = $bindable<string | null>(null), sessionToken = $bindable<string | null>(null) } =
		$props<{
			address?: string | null;
			sessionToken?: string | null;
		}>();
</script>

<nav class="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur">
	<div
		class="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 sm:h-16 sm:px-6 lg:px-8"
	>
		<a href="/" class="flex shrink-0 items-center gap-1.5 sm:gap-2" aria-label="Sheka home">
			<img src="/logo.png" alt="Sheka" class="h-8 w-8 sm:h-10 sm:w-10" />
			<span class="text-lg font-bold tracking-tight sm:text-xl">Sheka</span>
		</a>
		<div class="flex min-w-0 items-center">
			<WalletButton bind:address bind:sessionToken />
		</div>
	</div>
</nav>
