<script lang="ts">
	import { onMount } from 'svelte';
	import { getNonce, verifyAuth } from './api';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		connectWallet,
		disconnectWallet,
		getAvailableWallets,
		signPersonalMessage,
		silentReconnect
	} from './wallet';
	import type { WalletWithSuiFeatures } from '@mysten/wallet-standard';
	import { Wallet as WalletIcon } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	const STORAGE_KEY = 'sheka_auth';

	let {
		address = $bindable<string | null>(null),
		// eslint-disable-next-line no-useless-assignment
		sessionToken = $bindable<string | null>(null)
	} = $props<{
		address?: string | null;
		sessionToken?: string | null;
	}>();

	let isConnecting = $state(false);
	let pickerOpen = $state(false);
	let wallets = $state<WalletWithSuiFeatures[]>([]);

	function discover() {
		wallets = getAvailableWallets();
	}

	// Connect a wallet by name, then run the nonce → sign → verify session flow.
	// Works for both wallet-extensions and the Enoki Google (zkLogin) wallet.
	async function authenticate(walletName: string) {
		isConnecting = true;
		try {
			discover();
			await disconnectWallet(); // clear any prior wallet/session so the named one connects
			const connected = await connectWallet(walletName);
			const selectedAddress = connected.account.address;

			const { nonce } = await getNonce(selectedAddress);
			const signature = await signPersonalMessage(nonce);

			const auth = await verifyAuth({ address: selectedAddress, nonce, signature });

			address = auth.wallet_address;
			sessionToken = auth.session_token;
			// Persist so a reload can restore the session + silently reconnect.
			localStorage.setItem(
				STORAGE_KEY,
				JSON.stringify({
					token: auth.session_token,
					address: auth.wallet_address,
					walletName: connected.wallet.name,
					expiresAt: auth.expires_at
				})
			);
			toast.success('Signed in', { description: truncate(auth.wallet_address) });
		} catch (err) {
			address = null;
			sessionToken = null;
			toast.error('Sign-in failed', {
				description: err instanceof Error ? err.message : 'Connection failed'
			});
		} finally {
			isConnecting = false;
		}
	}

	function openPicker() {
		discover();
		pickerOpen = true;
	}

	function pick(walletName: string) {
		pickerOpen = false;
		void authenticate(walletName);
	}

	async function disconnect() {
		await disconnectWallet();
		address = null;
		sessionToken = null;
		localStorage.removeItem(STORAGE_KEY);
	}

	// On reload: restore a non-expired session + silently reconnect the wallet so
	// signing works again without a popup. Clears storage if reconnect fails.
	onMount(async () => {
		discover();
		let saved: { token: string; address: string; walletName: string; expiresAt: string } | null =
			null;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			saved = raw ? JSON.parse(raw) : null;
		} catch {
			// ignore malformed storage; `saved` stays null
		}
		if (!saved) return;
		if (!saved.expiresAt || new Date(saved.expiresAt).getTime() <= Date.now()) {
			localStorage.removeItem(STORAGE_KEY);
			return;
		}
		const reconnected = await silentReconnect(saved.walletName);
		if (reconnected && reconnected.account.address === saved.address) {
			address = saved.address;
			sessionToken = saved.token;
		} else {
			localStorage.removeItem(STORAGE_KEY);
		}
	});

	function truncate(addr: string): string {
		if (addr.length <= 12) return addr;
		return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
	}

	discover();
</script>

<div class="flex items-center gap-3">
	{#if address}
		<div class="flex items-center gap-2 rounded-md border border-border bg-surface-1 px-3 py-1.5">
			<WalletIcon class="h-4 w-4 text-primary" />
			<span class="font-mono text-sm text-ink">{truncate(address)}</span>
		</div>
		<Button variant="outline" size="sm" onclick={disconnect}>Disconnect</Button>
	{:else}
		<Button size="sm" onclick={openPicker} disabled={isConnecting}>
			<WalletIcon class="h-4 w-4" />
			{isConnecting ? 'Connecting…' : 'Connect'}
		</Button>
	{/if}
</div>

<Dialog.Root bind:open={pickerOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Connect</Dialog.Title>
			<Dialog.Description>Choose a wallet or sign in with Google.</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-2">
			{#if wallets.length === 0}
				<p class="py-4 text-center text-sm text-ink-muted">
					No Sui wallet detected. Install Slush or Suiet, or enable Google sign-in.
				</p>
			{:else}
				{#each wallets as w (w.name)}
					<button
						type="button"
						class="flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface-1"
						onclick={() => pick(w.name)}
					>
						{#if w.icon}
							<img src={w.icon} alt="" class="h-5 w-5 shrink-0" />
						{:else}
							<WalletIcon class="h-5 w-5 shrink-0 text-ink-muted" />
						{/if}
						<span class="font-medium text-ink">{w.name}</span>
					</button>
				{/each}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
