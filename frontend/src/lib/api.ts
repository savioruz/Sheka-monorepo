import { ApiError } from './types';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';

export interface RequestOptions {
	method?: 'GET' | 'POST';
	body?: unknown;
	token?: string | null;
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
