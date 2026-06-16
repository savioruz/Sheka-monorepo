import { beforeEach, describe, expect, test } from 'bun:test';
import { makeMockConfig } from '@config/config.mock';
import { createDb } from '@db/index';
import { nonces } from '@db/schema/nonces';
import { createNonceManager } from './nonce';

const mockConfig = makeMockConfig({
  database: {
    host: 'localhost',
    port: 5432,
    name: 'sheka_test',
    user: 'root',
    password: '',
    sslMode: 'disable',
  },
});

async function setupTestDb() {
  const db = createDb(mockConfig);
  await db.delete(nonces);
  return db;
}

describe('NonceManager', () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  test('storeNonce generates a sheka-prefixed nonce', async () => {
    const db = createDb(mockConfig);
    const manager = createNonceManager({ db });
    const { nonce } = await manager.storeNonce('0x123');
    expect(nonce.startsWith('sheka:')).toBe(true);
  });

  test('consumeNonce returns the wallet address for a valid nonce', async () => {
    const db = createDb(mockConfig);
    const manager = createNonceManager({ db });
    const { nonce } = await manager.storeNonce('0xabc');
    const result = await manager.consumeNonce(nonce);
    expect(result?.walletAddress).toBe('0xabc');
  });

  test('consumeNonce returns null for an unknown nonce', async () => {
    const db = createDb(mockConfig);
    const manager = createNonceManager({ db });
    const result = await manager.consumeNonce('sheka:1:unknown');
    expect(result).toBeNull();
  });

  test('consumeNonce removes the nonce from the database', async () => {
    const db = createDb(mockConfig);
    const manager = createNonceManager({ db });
    const { nonce } = await manager.storeNonce('0xdef');
    await manager.consumeNonce(nonce);
    const rows = await db.select().from(nonces).where(eqNonce(nonce));
    expect(rows.length).toBe(0);
  });
});

function eqNonce(nonce: string) {
  const { eq } = require('drizzle-orm');
  return eq(nonces.token, nonce);
}
