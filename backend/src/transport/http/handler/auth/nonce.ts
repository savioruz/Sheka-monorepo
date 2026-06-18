import type { NonceManager } from '@auth/nonce';
import { traced } from '@infras/otel/otel';
import type { Hono } from 'hono';
import { error, success } from '../../response';

export interface NonceHandlerDeps {
  nonceManager: NonceManager;
}

export function registerNonceRoutes(app: Hono, deps: NonceHandlerDeps) {
  const { nonceManager } = deps;

  app.get('/api/auth/nonce', async (c) => {
    const address = c.req.query('address');
    if (!address || !address.startsWith('0x')) {
      return c.json(error('invalid_address', 'Missing or invalid Sui address'), 400);
    }

    const { nonce, expiresAt } = await traced('auth.storeNonce', () =>
      nonceManager.storeNonce(address),
    );
    return c.json(success({ nonce, expires_at: expiresAt.toISOString() }));
  });
}
