<script lang="ts">
	import { WalletButton } from '$lib/features/wallet';
	import { claimable } from '$lib/features/claims';
	import { Badge } from '$lib/components/ui/badge';
	import {
		DropdownMenu,
		DropdownMenuTrigger,
		DropdownMenuContent,
		DropdownMenuItem
	} from '$lib/components/ui/dropdown-menu';
	import { Menu } from '@lucide/svelte';
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
			<!-- Desktop (sm+): inline links -->
			<div class="hidden items-center gap-3 sm:flex sm:gap-4">
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
			</div>

			<!-- Mobile (<sm): collapse Proofs + Claim into an overflow menu -->
			<div class="sm:hidden">
				<DropdownMenu>
					<DropdownMenuTrigger
						class="relative flex size-9 items-center justify-center rounded-md border border-border bg-surface-1 text-ink-muted transition-colors hover:text-ink"
						aria-label="Menu"
					>
						<Menu class="size-5" />
						{#if $claimable.length > 0}
							<span
								class="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
							>
								{$claimable.length}
							</span>
						{/if}
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" class="w-44">
						{#if $claimable.length > 0}
							<DropdownMenuItem>
								{#snippet child({ props })}
									<a href="/claim" {...props}>
										<span>Claim winnings</span>
										<Badge variant="default" class="ml-auto">{$claimable.length}</Badge>
									</a>
								{/snippet}
							</DropdownMenuItem>
						{/if}
						<DropdownMenuItem>
							{#snippet child({ props })}
								<a href="/proofs" {...props}>Proofs</a>
							{/snippet}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<WalletButton />
		</div>
	</div>
</nav>
