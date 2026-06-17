<script lang="ts">
	import { Pagination as PaginationPrimitive } from 'bits-ui';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: PaginationPrimitive.PrevButtonProps = $props();
</script>

<PaginationPrimitive.PrevButton
	bind:ref
	data-slot="pagination-prev"
	aria-label="Go to previous page"
	class={cn(
		buttonVariants({ variant: 'ghost', size: 'default' }),
		'gap-1 px-2.5 sm:pl-2.5',
		className
	)}
	{...restProps}
>
	{#if children}
		{@render children()}
	{:else}
		<ChevronLeftIcon class="size-4" />
		<span class="hidden sm:block">Previous</span>
	{/if}
</PaginationPrimitive.PrevButton>
