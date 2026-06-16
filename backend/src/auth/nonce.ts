import { randomBytes } from 'node:crypto';
import type { Database } from '@db/index';
import { nonces } from '@db/schema/nonces';
import { and, eq, gt } from 'drizzle-orm';

export interface NonceManagerDeps {
  db: Database;
}

export function createNonceManager(deps: NonceManagerDeps) {
  const { db } = deps;

  function generateNonce(walletAddress: string): string {
    const timestamp = Date.now();
    const random = randomBytes(8).toString('hex');
    return `sheka:${timestamp}:${random}`;
  }

  async function storeNonce(walletAddress: string): Promise<{ nonce: string; expiresAt: Date }> {
    const nonce = generateNonce(walletAddress);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.insert(nonces).values({
      type: 'nonce',
      token: nonce,
      walletAddress,
      expiresAt,
    });

    return { nonce, expiresAt };
  }

  async function consumeNonce(nonce: string): Promise<{ walletAddress: string } | null> {
    const rows = await db
      .select()
      .from(nonces)
      .where(
        and(eq(nonces.token, nonce), eq(nonces.type, 'nonce'), gt(nonces.expiresAt, new Date())),
      );

    if (rows.length === 0) return null;

    await db.delete(nonces).where(eq(nonces.token, nonce));
    return { walletAddress: rows[0].walletAddress };
  }

  return { storeNonce, consumeNonce };
}

export type NonceManager = ReturnType<typeof createNonceManager>;
