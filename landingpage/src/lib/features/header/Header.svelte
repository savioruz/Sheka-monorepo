<script lang="ts">
	import { ExternalLink } from '@lucide/svelte';
</script>

<header class="fixed top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
	<div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-gutter">
		<a
			href="/"
			class="flex items-center gap-stack-sm transition-colors duration-200 hover:text-primary-deep"
			aria-label="Sheka home"
		>
			<img src="/logotype.png" alt="Sheka" class="h-32 w-auto" />
		</a>
		<a
			href="https://testnet.sheka.xyz"
			class="glow-effect flex items-center gap-2 rounded bg-primary px-4 py-2 text-label-caps text-white transition-colors duration-100 hover:bg-primary-deep active:scale-95"
		>
			Launch App
			<ExternalLink class="size-4" />
		</a>
	</div>
</header>
