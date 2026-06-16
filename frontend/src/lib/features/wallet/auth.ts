import { getContext, setContext } from 'svelte';
import { writable, type Writable } from 'svelte/store';

export interface AuthState {
	address: string | null;
	sessionToken: string | null;
}

const AUTH_KEY = Symbol('auth');

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
