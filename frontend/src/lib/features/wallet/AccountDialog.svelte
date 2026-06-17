<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { suiClient, formatBalance } from '$lib/sui';
	import { Copy, RefreshCw } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	const DUSDC_TYPE = import.meta.env.VITE_DUSDC_TYPE ?? '';

	let {
		open = $bindable(false),
		address = '',
		onDisconnect
	} = $props<{
		open?: boolean;
		address?: string;
		onDisconnect: () => void | Promise<void>;
	}>();

	let loading = $state(false);
	let suiBal = $state<string | null>(null);
	let dusdcBal = $state<string | null>(null);

	async function loadBalances() {
		if (!address) return;
		loading = true;
		try {
			const [sui, dusdc] = await Promise.all([
				suiClient.getBalance({ owner: address }),
				DUSDC_TYPE
					? suiClient.getBalance({ owner: address, coinType: DUSDC_TYPE })
					: Promise.resolve({ totalBalance: '0' })
			]);
			suiBal = formatBalance(BigInt(sui.totalBalance), 9);
			dusdcBal = formatBalance(BigInt(dusdc.totalBalance), 6);
		} catch {
			suiBal = suiBal ?? '—';
			dusdcBal = dusdcBal ?? '—';
		} finally {
			loading = false;
		}
	}

	// Refetch each time the modal opens.
	$effect(() => {
		if (open) void loadBalances();
	});

	async function copyAddress() {
		try {
			await navigator.clipboard.writeText(address);
			toast.success('Address copied');
		} catch {
			toast.error('Copy failed');
		}
	}

	async function disconnect() {
		await onDisconnect();
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Account</Dialog.Title>
		</Dialog.Header>

		<div class="min-w-0 space-y-3">
			<!-- Address + copy -->
			<div class="flex items-start justify-between gap-2 rounded-md bg-surface-1 px-3 py-2">
				<span class="min-w-0 font-mono text-xs break-all text-ink">{address}</span>
				<Button
					variant="ghost"
					size="icon"
					class="size-7 shrink-0"
					onclick={copyAddress}
					title="Copy address"
				>
					<Copy class="h-4 w-4" />
				</Button>
			</div>

			<!-- Balances -->
			<div class="space-y-1">
				<div class="flex items-center justify-between text-sm">
					<span class="text-ink-muted">SUI</span>
					<span class="font-mono text-ink"
						>{loading && suiBal === null ? '…' : (suiBal ?? '—')}</span
					>
				</div>
				<div class="flex items-center justify-between text-sm">
					<span class="text-ink-muted">DUSDC</span>
					<span class="font-mono text-ink">
						{loading && dusdcBal === null ? '…' : (dusdcBal ?? '—')}
					</span>
				</div>
				<button
					type="button"
					class="flex items-center gap-1 pt-1 text-xs text-ink-subdued hover:text-ink"
					onclick={loadBalances}
					disabled={loading}
				>
					<RefreshCw class="h-3 w-3 {loading ? 'animate-spin' : ''}" /> Refresh
				</button>
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" class="w-full" onclick={disconnect}>Disconnect</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
