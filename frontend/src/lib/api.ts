import { ApiError } from './types';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export interface RequestOptions {
	method?: 'GET' | 'POST';
	body?: unknown;
	token?: string | null;
}

// A 401 on a token-bearing request means the session token expired/was revoked
// (24h TTL, no refresh). The layout registers a handler that clears the session
// and prompts re-auth. Kept here so the API layer stays decoupled from Svelte.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
	onUnauthorized = fn;
}
/** Trigger the registered 401 handler (for code paths that bypass `request`, e.g. SSE). */
export function notifyUnauthorized(): void {
	onUnauthorized?.();
}

/** Shared fetch core — every feature's api.ts builds on this. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const url = `${API_BASE_URL}${path}`;
	const headers: Record<string, string> = {
		Accept: 'application/json'
	};

	if (options.token) {
		headers.Authorization = `Bearer ${options.token}`;
	}

	const init: RequestInit = {
		method: options.method ?? 'GET',
		headers
	};

	if (options.body !== undefined) {
		headers['Content-Type'] = 'application/json';
		init.body = JSON.stringify(options.body);
	}

	const response = await fetch(url, init);
	const text = await response.text();
	let json: unknown = null;

	if (text) {
		try {
			json = JSON.parse(text);
		} catch {
			throw new ApiError('Invalid JSON response', response.status, text);
		}
	}

	if (!response.ok) {
		// Expired/invalid session on an authed call → clear session + prompt re-auth.
		if (response.status === 401 && options.token) onUnauthorized?.();
		const message =
			typeof json === 'object' && json !== null && 'message' in json
				? String((json as { message: unknown }).message)
				: `HTTP ${response.status}`;
		throw new ApiError(message, response.status, json);
	}

	return json as T;
}

/** Unwrap the `{ data: T }` envelope the backend returns. */
export function unwrap<T>(response: { data: T }): T {
	return response.data;
}
