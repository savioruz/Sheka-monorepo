<script lang="ts">
	import { Markets, StakeDialog } from '$lib/features/markets';
	import { NewsFeed } from '$lib/features/news';
	import {
		buildStakeTransaction,
		buildClaimTransaction,
		getDusdcCoinObjects,
		OUTCOME_LABEL,
		type Market,
		type UserPosition
	} from '$lib/features/markets';
	import { suiClient } from '$lib/sui';
	import { signTransaction, getAuthStore } from '$lib/features/wallet';
	import { toast } from 'svelte-sonner';

	const DUSDC_TYPE = import.meta.env.VITE_DUSDC_TYPE ?? '';
	const DUSDC_DECIMALS = 1_000_000; // 6 dp
	// Minimum SUI (in MIST) the wallet needs to cover gas (gas budget is 0.05 SUI).
	const MIN_GAS_MIST = 60_000_000n;

	// Wallet/session come from the shared store (navbar lives in the layout).
	const auth = getAuthStore();
	const walletAddress = $derived($auth.address);
	const sessionToken = $derived($auth.sessionToken);
	let marketsRef = $state<{ reload: () => void } | undefined>();

	// Refresh the markets panel once the tx has propagated to the RPC, so pools
	// and positions reflect the just-placed stake/claim without a hard reload.
	async function refreshMarkets(digest: string) {
		try {
			await suiClient.waitForTransaction({ digest });
		} catch {
			/* best-effort; the 15s poll will catch up regardless */
		}
		marketsRef?.reload();
	}

	// --- Prediction market staking ---
	let stakeOpen = $state(false);
	let staking = $state(false);
	let stakeBalance = $state(0n); // wallet DUSDC (base units) available to the dialog
	let pendingStake = $state<{
		market: Market;
		outcome: number;
		dusdcCoinObjectIds: string[];
	} | null>(null);

	async function handleStake(market: Market, outcome: number) {
		if (!walletAddress) {
			toast.error('Connect your wallet first');
			return;
		}
		if (staking) return;
		try {
			const sui = await suiClient.getBalance({ owner: walletAddress });
			if (BigInt(sui.totalBalance) < MIN_GAS_MIST) {
				toast.error('No SUI for gas', { description: 'Fund this wallet with testnet SUI.' });
				return;
			}
			const coins = await getDusdcCoinObjects(suiClient, walletAddress, DUSDC_TYPE);
			const balance = coins.reduce((s, c) => s + c.balance, 0n);
			if (balance < BigInt(DUSDC_DECIMALS)) {
				toast.warning('Need at least 1 DUSDC', {
					description: 'This wallet has less than 1 testnet DUSDC.'
				});
				return;
			}
			pendingStake = { market, outcome, dusdcCoinObjectIds: coins.map((c) => c.objectId) };
			stakeBalance = balance;
			stakeOpen = true;
		} catch (err) {
			toast.error('Could not prepare stake', {
				description: err instanceof Error ? err.message : String(err)
			});
		}
	}

	async function confirmStake(amount: number) {
		if (!pendingStake || !walletAddress || staking) return;
		const p = pendingStake;
		staking = true;
		let toastId: string | number | undefined;
		try {
			toastId = toast.loading('Submitting stake…', { description: 'Approve the wallet popup.' });
			const tx = buildStakeTransaction({
				marketId: p.market.market_object_id,
				outcome: p.outcome,
				amount,
				dusdcCoinObjectIds: p.dusdcCoinObjectIds
			});
			const { bytes, signature } = await signTransaction(tx);
			const res = await suiClient.executeTransactionBlock({
				transactionBlock: bytes,
				signature,
				options: { showEffects: true }
			});
			toast.success('Stake placed', {
				id: toastId,
				description: `${OUTCOME_LABEL[p.outcome]} · ${res.digest.slice(0, 14)}…`
			});
			stakeOpen = false;
			pendingStake = null;
			void refreshMarkets(res.digest);
		} catch (err) {
			toast.error('Stake failed', {
				id: toastId,
				description: err instanceof Error ? err.message : 'Stake failed'
			});
		} finally {
			staking = false;
		}
	}

	async function handleClaim(market: Market, position: UserPosition) {
		if (!walletAddress) return;
		const toastId = toast.loading('Claiming…');
		try {
			const tx = buildClaimTransaction({
				marketId: market.market_object_id,
				positionId: position.id
			});
			const { bytes, signature } = await signTransaction(tx);
			const res = await suiClient.executeTransactionBlock({
				transactionBlock: bytes,
				signature,
				options: { showEffects: true, showBalanceChanges: true }
			});
			const dusdc = res.balanceChanges?.find((b) => b.coinType === DUSDC_TYPE);
			const won = dusdc ? Number(dusdc.amount) / DUSDC_DECIMALS : 0;
			toast.success('Claimed', {
				id: toastId,
				description: won > 0 ? `+${won} DUSDC` : 'No payout (losing position)'
			});
			void refreshMarkets(res.digest);
		} catch (err) {
			toast.error('Claim failed', {
				id: toastId,
				description: err instanceof Error ? err.message : 'Claim failed'
			});
		}
	}
</script>

<main class="mx-auto max-w-5xl py-6 md:px-8 lg:max-w-6xl">
	<!-- Desktop (lg+): markets left, news in a right rail. Below lg: news stacks under. -->
	<div class="lg:flex lg:items-start lg:gap-6">
		<div class="min-w-0 lg:flex-1">
			<Markets
				bind:this={marketsRef}
				{walletAddress}
				{sessionToken}
				onStake={handleStake}
				onClaim={handleClaim}
			/>
		</div>
		<aside class="lg:w-80 lg:shrink-0">
			<NewsFeed />
		</aside>
	</div>
</main>

<StakeDialog
	bind:open={stakeOpen}
	market={pendingStake?.market ?? null}
	outcome={pendingStake?.outcome ?? 0}
	balance={stakeBalance}
	loading={staking}
	onConfirm={confirmStake}
/>
