<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';

	let {
		open = $bindable(false),
		title = 'Are you sure?',
		description = '',
		details = [],
		confirmText = 'Confirm',
		cancelText = 'Cancel',
		loading = false,
		onConfirm
	} = $props<{
		open?: boolean;
		title?: string;
		description?: string;
		details?: { label: string; value: string }[];
		confirmText?: string;
		cancelText?: string;
		loading?: boolean;
		onConfirm: () => void;
	}>();
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		showCloseButton={!loading}
		onInteractOutside={(e: Event) => loading && e.preventDefault()}
		onEscapeKeydown={(e: Event) => loading && e.preventDefault()}
	>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			{#if description}
				<Dialog.Description>{description}</Dialog.Description>
			{/if}
		</Dialog.Header>

		{#if details.length > 0}
			<dl class="space-y-2 rounded-md bg-muted p-4 text-sm">
				{#each details as d (d.label)}
					<div class="flex items-center justify-between gap-4">
						<dt class="text-muted-foreground">{d.label}</dt>
						<dd class="font-mono font-medium text-foreground">{d.value}</dd>
					</div>
				{/each}
			</dl>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={loading}>
				{cancelText}
			</Button>
			<Button onclick={onConfirm} disabled={loading}>
				{loading ? 'Working…' : confirmText}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
