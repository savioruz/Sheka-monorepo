<script lang="ts">
	// Enoki opens Google sign-in in a popup; Google redirects that popup here.
	// The opener window reads this page's URL hash and finalizes the zkLogin
	// session, then closes the popup — so this page just needs to exist and be
	// same-origin. Nothing to do here (it's closed within milliseconds).
</script>

<div class="flex min-h-screen items-center justify-center">
	<p class="text-sm text-ink-muted">Signing you in…</p>
</div>
