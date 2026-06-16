import { request, unwrap } from '$lib/api';
import type { AuthNonceResponse, AuthVerifyRequest, AuthVerifyResponse } from '$lib/types';

export async function getNonce(address: string): Promise<AuthNonceResponse> {
	const response = await request<{ data: AuthNonceResponse }>(
		`/api/auth/nonce?address=${encodeURIComponent(address)}`
	);
	return unwrap(response);
}

export async function verifyAuth(body: AuthVerifyRequest): Promise<AuthVerifyResponse> {
	const response = await request<{ data: AuthVerifyResponse }>('/api/auth/verify', {
		method: 'POST',
		body
	});
	return unwrap(response);
}
