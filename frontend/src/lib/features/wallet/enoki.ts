import { registerEnokiWallets, isGoogleWallet } from '@mysten/enoki';
import { suiClient } from '$lib/sui';

let registered = false;

/**
 * Register Enoki (Google zkLogin) as a wallet-standard wallet. Browser-only and
 * idempotent. Once registered, "Sign in with Google" appears in
 * `getAvailableWallets()` and connects via the usual wallet-standard flow (a
 * popup, so the page is never navigated away). No-op when the Enoki/Google env
 * vars aren't set — zkLogin is simply absent until configured.
 */
export function setupEnoki(): void {
	if (registered || typeof window === 'undefined') return;
	const apiKey = import.meta.env.VITE_ENOKI_API_KEY as string | undefined;
	const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
	if (!apiKey || !clientId) return;

	registerEnokiWallets({
		apiKey,
		network: 'testnet',
		// suiClient (@mysten/sui SuiClient) satisfies Enoki's ClientWithCoreApi at
		// runtime; cast the options to bridge the structural type difference.
		client: suiClient,
		providers: {
			google: {
				clientId,
				redirectUrl: `${window.location.origin}/auth/callback`,
				// Always show the Google account chooser so users can switch accounts.
				extraParams: { prompt: 'select_account' }
			}
		}
	} as unknown as Parameters<typeof registerEnokiWallets>[0]);
	registered = true;
}

export { isGoogleWallet };
