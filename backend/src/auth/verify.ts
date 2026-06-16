import { randomBytes } from 'node:crypto';
import type { Database } from '@db/index';
import { nonces } from '@db/schema/nonces';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { and, eq, gt } from 'drizzle-orm';
import type { NonceManager } from './nonce';

export interface VerifyDeps {
  db: Database;
  nonceManager: NonceManager;
}

export function createVerifier(deps: VerifyDeps) {
  const { db, nonceManager } = deps;

  async function verifyWalletSignature(
    address: string,
    nonce: string,
    signature: string,
  ): Promise<boolean> {
    const stored = await nonceManager.consumeNonce(nonce);
    if (!stored) return false;

    try {
      const result = await verifyPersonalMessageSignature(
        new TextEncoder().encode(nonce),
        signature,
      );
      return result.toSuiAddress().toLowerCase() === address.toLowerCase();
    } catch {
      return false;
    }
  }

  async function issueSessionToken(
    walletAddress: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.insert(nonces).values({
      type: 'session',
      token,
      walletAddress,
      expiresAt,
    });

    return { token, expiresAt };
  }

  async function validateSessionToken(token: string): Promise<string | null> {
    const rows = await db
      .select()
      .from(nonces)
      .where(
        and(eq(nonces.token, token), eq(nonces.type, 'session'), gt(nonces.expiresAt, new Date())),
      )
      .limit(1);

    return rows.length > 0 ? rows[0].walletAddress : null;
  }

  return { verifyWalletSignature, issueSessionToken, validateSessionToken };
}

export type Verifier = ReturnType<typeof createVerifier>;
