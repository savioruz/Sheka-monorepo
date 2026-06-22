<script lang="ts">
	import { Globe, EyeOff } from '@lucide/svelte';
</script>

<section class="grid w-full grid-cols-1 gap-stack-lg md:grid-cols-2">
	<div class="mb-4 text-center md:col-span-2">
		<h2 class="text-headline-lg-mobile text-ink md:text-headline-lg">
			Trustless and private, at the same time.
		</h2>
	</div>

	<!-- Public proof on Walrus -->
	<div class="flex flex-col gap-4 rounded-2xl border border-border bg-surface-1 p-stack-lg">
		<div class="flex items-center gap-3">
			<Globe class="text-primary-deep" />
			<h3 class="text-headline-md text-ink">Public proof on Walrus</h3>
		</div>
		<div
			class="terminal-line rounded-lg border border-border bg-card p-4 font-mono text-data-sm text-ink"
		>
			<div class="mb-2 text-ink-muted/70">// Hashed reasoning payload</div>
			<div><span class="text-primary-deep">"market_id"</span>: "sui_usd_24h",</div>
			<div class="pl-4"><span class="text-primary-deep">"confidence_score"</span>: 0.89,</div>
			<div class="pl-4"><span class="text-primary-deep">"model_version"</span>: "v1.4.2",</div>
			<div class="pl-4"><span class="text-primary-deep">"walrus_blob_id"</span>: "wt...9f2x"}</div>
		</div>
	</div>

	<!-- Private via Seal -->
	<div class="flex flex-col gap-4 rounded-2xl border border-border bg-surface-1 p-stack-lg">
		<div class="flex items-center gap-3">
			<EyeOff class="text-seal" />
			<h3 class="text-headline-md text-ink">Private via Seal</h3>
		</div>
		<div
			class="terminal-line rounded-lg border border-border border-l-seal/50 bg-card p-4 font-mono text-data-sm text-ink"
		>
			<div class="mb-2 text-seal">// Encrypted execution layer</div>
			<div class="blur-sm select-none">
				{'{"user_address": "0x...", "stake": "500_SUI", "slippage": "0.5%"}'}
			</div>
			<div class="mt-4 text-xs tracking-widest text-ink-muted uppercase">Owner Access Only</div>
		</div>
	</div>
</section>
