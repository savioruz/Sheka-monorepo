import type { Verifier } from '@auth/verify';
import { zValidator } from '@hono/zod-validator';
import type { Hono } from 'hono';
import { z } from 'zod';
import { error, success } from '../../response';

export interface VerifyHandlerDeps {
  verifier: Verifier;
}

const verifySchema = z.object({
  address: z.string(),
  nonce: z.string(),
  signature: z.string(),
  zk_proof: z.any().optional(),
});

export function registerVerifyRoutes(app: Hono, deps: VerifyHandlerDeps) {
  const { verifier } = deps;

  app.post('/api/auth/verify', zValidator('json', verifySchema), async (c) => {
    const body = c.req.valid('json');

    const valid = await verifier.verifyWalletSignature(body.address, body.nonce, body.signature);
    if (!valid) {
      return c.json(error('unauthorized', 'Nonce not found, expired, or signature mismatch'), 401);
    }

    const { token, expiresAt } = await verifier.issueSessionToken(body.address);
    return c.json(
      success({
        session_token: token,
        wallet_address: body.address,
        expires_at: expiresAt.toISOString(),
      }),
    );
  });
}
