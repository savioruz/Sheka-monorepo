<script lang="ts">
	import { Pagination as PaginationPrimitive } from 'bits-ui';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: PaginationPrimitive.NextButtonProps = $props();
</script>

<PaginationPrimitive.NextButton
	bind:ref
	data-slot="pagination-next"
	aria-label="Go to next page"
	class={cn(
		buttonVariants({ variant: 'ghost', size: 'default' }),
		'gap-1 px-2.5 sm:pr-2.5',
		className
	)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{:else}
		<span class="hidden sm:block">Next</span>
		<ChevronRightIcon class="size-4" />
	{/if}
</PaginationPrimitive.NextButton>
