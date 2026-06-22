<script lang="ts">
	import './layout.css';

	let { children } = $props();
</script>

<div class="relative flex min-h-screen flex-col overflow-x-hidden">
	<!-- Global background glow -->
	<div class="bg-glow-gradient pointer-events-none absolute inset-0 -z-10"></div>
	{@render children()}
</div>
