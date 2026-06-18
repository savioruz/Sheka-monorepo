<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { TrendingUp, TrendingDown, Sparkles, ChevronsUpDown } from '@lucide/svelte';
	import { suiClient } from '$lib/sui';
	import { signTransaction } from '$lib/features/wallet';
	import { getDusdcCoinObjects, getModels, type Model } from '$lib/features/markets';
	import {
		getQuota,
		getMyAnalyses,
		buildClaimFreeTransaction,
		buildPurchaseTransaction,
		decryptAnalysis,
		ProofBadge
	} from '$lib/features/analysis';
	import { toast } from 'svelte-sonner';
	import {
		quoteTrade,
		findManager,
		buildCreateManagerTransaction,
		buildBuyTransaction,
		DUSDC_SCALE,
		type MarketKeyInput
	} from './predict';
	import { analyzeCrypto, type CryptoMarket, type CryptoRecommendation } from './api';

	const DUSDC_TYPE = import.meta.env.VITE_DUSDC_TYPE ?? '';

	let {
		open = $bindable(false),
		market = null,
		isUp = true,
		walletAddress = null,
		sessionToken = null
	} = $props<{
		open?: boolean;
		market?: CryptoMarket | null;
		isUp?: boolean;
		walletAddress?: string | null;
		sessionToken?: string | null;
	}>();

	// Strike defaults to the nearest $100 to spot; win amount = payout if correct.
	let strike = $state(0);
	let winAmount = $state(1);
	let quote = $state<{ cost: number; impliedProb: number; costBaseUnits: bigint } | null>(null);
	let quoting = $state(false);
	let buying = $state(false);
	let quoteSeq = 0;

	// --- AI analysis (same on-chain paid/free gate + Walrus proof as sports) ---
	type Pick = NonNullable<CryptoRecommendation['recommendation']>;
	let modelsList = $state<Model[]>([]);
	let selectedModelId = $state(0);
	let freeRemaining = $state<number | null>(null);
	let analyzing = $state(false);
	let rec = $state<Pick | null>(null);
	let proofBlobId = $state<string | null>(null);
	let expandedReason = $state(false);
	// Seal-encrypted full result (owner-only): captured from the analyze response.
	let sealRef = $state<{ blobId: string; receiptId: string } | null>(null);
	let decrypting = $state(false);
	let decrypted = $state(false);

	const selectedModel = $derived(modelsList.find((m) => m.id === selectedModelId) ?? modelsList[0]);
	function modelSuffix(model: Model | undefined): string {
		if (!model) return '';
		return model.free && (freeRemaining ?? 0) > 0
			? `${freeRemaining} free left`
			: `${model.price_sui} SUI`;
	}

	// Clear an analysis only when the MARKET changes (strike/side are just trade
	// inputs; the shown result is labelled with the strike/side it was run for).
	// Declared before the surface effect so cleared state is visible to it.
	$effect(() => {
		void market?.oracle_id;
		rec = null;
		proofBlobId = null;
		expandedReason = false;
		sealRef = null;
		decrypted = false;
	});

	// Load the model price list + free quota once the dialog opens, and re-surface
	// any analysis this wallet already owns for THIS market (so the decrypt button
	// survives closing/reopening the modal — owned state lives in the DB, not memory).
	$effect(() => {
		if (!open) return;
		if (modelsList.length === 0) {
			void getModels()
				.then((r) => {
					modelsList = r.models;
					if (r.models.length > 0) selectedModelId = r.models[0].id;
				})
				.catch(() => {});
		}
		const token = sessionToken;
		const oracleId = market?.oracle_id;
		if (token) {
			if (freeRemaining === null) {
				void getQuota(token)
					.then((q) => (freeRemaining = q.free_remaining))
					.catch(() => {});
			}
			// Only fetch when we don't already have a (fresh or owned) reference.
			if (oracleId && !sealRef && !proofBlobId) {
				void getMyAnalyses(token)
					.then((r) => {
						const owned = r.analyses.find((a) => a.market_id === oracleId);
						if (!owned || market?.oracle_id !== oracleId) return;
						if (owned.blob_id) sealRef = { blobId: owned.blob_id, receiptId: owned.receipt_id };
						if (owned.public_blob_id) proofBlobId = owned.public_blob_id;
					})
					.catch(() => {});
			}
		}
	});

	// Seed the strike when the dialog opens on a market.
	$effect(() => {
		if (open && market?.spot) strike = Math.round(market.spot / 100) * 100;
	});

	const key = $derived<MarketKeyInput | null>(
		market ? { oracleId: market.oracle_id, expiry: market.expiry, strike, isUp } : null
	);

	// Re-quote (debounced) whenever the key or amount changes.
	$effect(() => {
		const k = key;
		const qty = BigInt(Math.max(0, Math.round(winAmount * DUSDC_SCALE)));
		if (!open || !k || qty <= 0n) {
			quote = null;
			return;
		}
		const seq = ++quoteSeq;
		quoting = true;
		const t = setTimeout(async () => {
			const q = await quoteTrade(k, qty);
			if (seq !== quoteSeq) return; // stale
			quote = q
				? { cost: q.cost, impliedProb: q.impliedProb, costBaseUnits: q.costBaseUnits }
				: null;
			quoting = false;
		}, 250);
		return () => clearTimeout(t);
	});

	async function exec(tx: Parameters<typeof signTransaction>[0], opts = {}) {
		const { bytes, signature } = await signTransaction(tx);
		return suiClient.executeTransactionBlock({
			transactionBlock: bytes,
			signature,
			options: { showEffects: true, ...opts }
		});
	}

	async function buy() {
		if (!walletAddress || !market || !key || !quote || buying) return;
		buying = true;
		const toastId = toast.loading('Preparing trade…');
		try {
			const coins = await getDusdcCoinObjects(suiClient, walletAddress, DUSDC_TYPE);
			if (coins.length === 0) throw new Error('No DUSDC in this wallet');

			// First-time: create the shared PredictManager, read its id from effects.
			let manager = await findManager(walletAddress);
			if (!manager) {
				toast.loading('Creating your prediction account…', { id: toastId });
				const res = await exec(buildCreateManagerTransaction(), { showObjectChanges: true });
				const created = res.objectChanges?.find(
					(ch) => ch.type === 'created' && ch.objectType.includes('predict_manager::PredictManager')
				);
				manager = created && 'objectId' in created ? created.objectId : null;
				if (!manager) throw new Error('Could not create prediction account');
			}

			const qty = BigInt(Math.round(winAmount * DUSDC_SCALE));
			// Deposit cost + 5% buffer to absorb price movement between quote and execution.
			const depositBaseUnits = (quote.costBaseUnits * 105n) / 100n + 1n;
			toast.loading('Submitting trade…', { id: toastId, description: 'Approve the wallet popup.' });
			const res = await exec(
				buildBuyTransaction({
					manager,
					key,
					qty,
					depositBaseUnits,
					dusdcCoinObjectIds: coins.map((c) => c.objectId)
				})
			);
			toast.success(`Bought ${isUp ? 'Up' : 'Down'} · ${market.asset}`, {
				id: toastId,
				description: `${res.digest.slice(0, 14)}…`
			});
			open = false;
		} catch (err) {
			toast.error('Trade failed', {
				id: toastId,
				description: err instanceof Error ? err.message : 'Trade failed'
			});
		} finally {
			buying = false;
		}
	}

	// Analyze the exact strike + side the user picked in this dialog.
	async function analyze() {
		if (!walletAddress || !sessionToken) {
			toast.error('Connect your wallet first');
			return;
		}
		if (!market || analyzing) return;
		const model = selectedModel;
		if (!model) return;

		const useFree = model.free && (freeRemaining ?? 0) > 0;
		analyzing = true;
		const toastId = toast.loading(
			useFree ? 'Claiming free analysis…' : `Paying ${model.price_sui} SUI…`,
			{ description: 'Approve the wallet popup.' }
		);
		try {
			const tx = useFree
				? buildClaimFreeTransaction(model.id)
				: buildPurchaseTransaction(model.id, model.price_mist);
			const res = await exec(tx);
			toast.loading(`Running ${model.label}…`, { id: toastId });
			const r = await analyzeCrypto(
				market.oracle_id,
				model.id,
				res.digest,
				strike,
				isUp,
				sessionToken
			);
			if (r.recommendation) {
				rec = r.recommendation;
				proofBlobId = r.public_blob_id ?? null;
				sealRef = r.blob_id && r.receipt_id ? { blobId: r.blob_id, receiptId: r.receipt_id } : null;
				decrypted = false;
				toast.success('Analysis ready', {
					id: toastId,
					description: `${model.label}: ${r.recommendation.model_prob}% ${r.recommendation.side}`
				});
			} else {
				toast.error('No result (retry — you were not charged)', {
					id: toastId,
					description: r.message ?? ''
				});
			}
			if (sessionToken) {
				try {
					freeRemaining = (await getQuota(sessionToken)).free_remaining;
				} catch {
					/* ignore */
				}
			}
		} catch (err) {
			toast.error('Analyze failed', {
				id: toastId,
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			analyzing = false;
		}
	}

	// Owner-only proof: re-fetch the Seal ciphertext from Walrus and decrypt it
	// client-side (SessionKey + on-chain seal_approve). Works only while the wallet
	// still holds the matching analysis receipt.
	async function decrypt() {
		if (!sealRef || !walletAddress || decrypting) return;
		decrypting = true;
		const toastId = toast.loading('Decrypting from Walrus…', {
			description: 'Sign the Seal session request.'
		});
		try {
			const plain = await decryptAnalysis(sealRef.blobId, sealRef.receiptId, walletAddress);
			rec = plain as unknown as Pick;
			decrypted = true;
			toast.success('Decrypted — you own this analysis', { id: toastId });
		} catch (err) {
			toast.error('Decrypt failed', {
				id: toastId,
				description: err instanceof Error ? err.message : String(err)
			});
		} finally {
			decrypting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				{#if isUp}
					<TrendingUp class="h-5 w-5 text-success" /> Bet Up
				{:else}
					<TrendingDown class="h-5 w-5 text-error" /> Bet Down
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if market}
					Will {market.asset} be {isUp ? '≥' : '<'} your strike at expiry? Spot ${market.spot?.toLocaleString(
						undefined,
						{ maximumFractionDigits: 0 }
					)}.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-3">
			<div class="flex gap-2">
				<button
					type="button"
					onclick={() => (isUp = true)}
					class="flex-1 border p-2 text-sm {isUp
						? 'border-success text-success'
						: 'border-border text-ink-muted'}"
				>
					Up (≥)
				</button>
				<button
					type="button"
					onclick={() => (isUp = false)}
					class="flex-1 border p-2 text-sm {!isUp
						? 'border-error text-error'
						: 'border-border text-ink-muted'}"
				>
					Down (&lt;)
				</button>
			</div>

			<label class="block text-xs text-ink-muted">
				Strike (USD)
				<input
					type="number"
					step="100"
					bind:value={strike}
					class="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:border-ring focus:outline-none"
				/>
			</label>

			<label class="block text-xs text-ink-muted">
				Win amount (DUSDC if correct)
				<input
					type="number"
					min="1"
					step="1"
					bind:value={winAmount}
					class="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:border-ring focus:outline-none"
				/>
			</label>

			<div class="bg-surface-1 p-3 text-sm">
				{#if quoting && !quote}
					<p class="text-ink-subdued">Quoting…</p>
				{:else if quote}
					<div class="flex items-center justify-between">
						<span class="text-ink-muted">You pay</span>
						<span class="font-mono font-semibold text-ink">{quote.cost.toFixed(2)} DUSDC</span>
					</div>
					<div class="flex items-center justify-between">
						<span class="text-ink-muted">If correct, you win</span>
						<span class="font-mono text-success">{winAmount} DUSDC</span>
					</div>
					<div class="mt-1 flex items-center justify-between text-xs text-ink-subdued">
						<span>Market-implied chance</span>
						<span class="font-mono">{(quote.impliedProb * 100).toFixed(0)}%</span>
					</div>
				{:else}
					<p class="text-ink-subdued">Enter a strike and amount.</p>
				{/if}
			</div>

			<!-- AI analysis: pick model + analyze (free Auto or paid) for this strike/side -->
			<div class="border-t border-border pt-3">
				{#if walletAddress && sessionToken}
					<div class="flex items-center gap-2">
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="outline"
										size="sm"
										class="flex-1 justify-between gap-2"
									>
										<span class="truncate">{selectedModel?.label ?? 'Auto'}</span>
										<span class="flex shrink-0 items-center gap-1 text-ink-subdued">
											{modelSuffix(selectedModel)}
											<ChevronsUpDown class="h-3.5 w-3.5 opacity-60" />
										</span>
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content class="w-60" align="start">
								<DropdownMenu.RadioGroup
									value={String(selectedModelId)}
									onValueChange={(v) => (selectedModelId = Number(v))}
								>
									{#each modelsList as model (model.id)}
										<DropdownMenu.RadioItem value={String(model.id)}>
											<span class="flex w-full items-center justify-between gap-3">
												<span>{model.label}</span>
												<span class="text-xs text-ink-subdued">{modelSuffix(model)}</span>
											</span>
										</DropdownMenu.RadioItem>
									{/each}
								</DropdownMenu.RadioGroup>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
						<Button size="sm" onclick={analyze} disabled={analyzing || !selectedModel}>
							{#if analyzing}
								Analyzing…
							{:else}
								<Sparkles class="h-3.5 w-3.5" /> Analyze
							{/if}
						</Button>
					</div>

					{#if rec || sealRef || proofBlobId}
						<div class="mt-2 bg-primary-subtle/40 p-2 text-xs">
							{#if rec}
								<p class="font-semibold text-primary-deep">
									🤖 {rec.model_prob}% chance {rec.side} (strike ${rec.strike})
									{#if rec.has_edge}· <span class="text-success">+{rec.edge}% edge</span>{:else}·
										<span class="text-ink-muted">no edge</span>{/if}
									· {rec.confidence_tier}
								</p>
								<p class="mt-0.5 text-ink-muted">
									Market-implied {rec.implied_prob ?? '—'}% · suggested size {rec.f_star}% (Kelly)
								</p>
								<button
									type="button"
									class="mt-1 block w-full cursor-pointer text-left text-ink-subdued {expandedReason
										? 'whitespace-pre-line'
										: 'line-clamp-3'}"
									title={expandedReason ? 'Show less' : 'Show more'}
									onclick={() => (expandedReason = !expandedReason)}
								>
									{rec.reasoning}
								</button>
								<p class="mt-1 text-[11px] text-ink-subdued">
									Crypto direction is hard to beat — treat the edge as a hint, not a guarantee.
								</p>
							{:else}
								<p class="text-ink-muted">
									🔒 You own an analysis for this market — decrypt to view.
								</p>
							{/if}

							{#if proofBlobId || sealRef}
								<div class="mt-2 flex flex-col gap-1.5 pt-2">
									{#if proofBlobId}
										<ProofBadge publicBlobId={proofBlobId} />
									{/if}
									{#if sealRef}
										<div class="flex items-center justify-between gap-2">
											<span class="truncate text-[10px] text-ink-muted">
												{decrypted
													? '🔓 Decrypted — owner-verified via Seal'
													: '🔒 Full result Seal-encrypted · owner-only'}
											</span>
											{#if !decrypted}
												<Button
													size="sm"
													variant="outline"
													class="h-7 shrink-0"
													onclick={decrypt}
													disabled={decrypting}
												>
													{decrypting ? 'Decrypting…' : 'Decrypt to view'}
												</Button>
											{/if}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				{:else}
					<p class="text-center text-xs text-ink-subdued">Connect your wallet for AI analysis.</p>
				{/if}
			</div>
		</div>

		<Dialog.Footer>
			{#if !walletAddress}
				<p class="text-center text-sm text-ink-muted">Connect your wallet to trade.</p>
			{:else}
				<Button class="w-full" onclick={buy} disabled={!quote || buying}>
					{buying ? 'Submitting…' : `Buy ${isUp ? 'Up' : 'Down'}`}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
