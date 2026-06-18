import { getContext, setContext } from 'svelte';
import { writable, type Writable } from 'svelte/store';

export interface AuthState {
	address: string | null;
	sessionToken: string | null;
}

const AUTH_KEY = Symbol('auth');

// Persisted session (token + wallet) so a reload can silently reconnect.
export const STORAGE_KEY = 'sheka_auth';

/** Clear the in-memory session + persisted storage (on sign-out or 401 expiry). */
export function clearAuth(store: Writable<AuthState>): void {
	store.set({ address: null, sessionToken: null });
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* SSR / no storage — ignore */
	}
}

export function initAuthStore(): Writable<AuthState> {
	const store = writable<AuthState>({
		address: null,
		sessionToken: null
	});
	setContext(AUTH_KEY, store);
	return store;
}

export function getAuthStore(): Writable<AuthState> {
	return getContext<Writable<AuthState>>(AUTH_KEY);
}

export function isAuthenticated(auth: AuthState): boolean {
	return auth.sessionToken !== null && auth.address !== null;
}
