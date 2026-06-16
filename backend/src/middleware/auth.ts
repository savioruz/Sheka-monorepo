import type { Verifier } from '@auth/verify';
import type { MiddlewareHandler } from 'hono';

export interface AuthMiddlewareDeps {
  verifier: Verifier;
}

export function createAuthMiddleware(deps: AuthMiddlewareDeps): MiddlewareHandler {
  const { verifier } = deps;

  return async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return c.json(
        { error: 'unauthorized', message: 'Missing or invalid Authorization header' },
        401,
      );
    }

    const token = header.slice(7);
    const walletAddress = await verifier.validateSessionToken(token);

    if (!walletAddress) {
      return c.json({ error: 'unauthorized', message: 'Invalid or expired session token' }, 401);
    }

    c.set('walletAddress', walletAddress);
    await next();
  };
}
