import type { Config } from '@config/config';
import { config } from '@config/config';
import type { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

export function buildDatabaseUrl(cfg: Config): string {
  const { host, port, name, user, password, sslMode } = cfg.database;
  const safePassword = encodeURIComponent(password);
  return `postgres://${user}:${safePassword}@${host}:${port}/${name}?sslmode=${sslMode}`;
}

export function createDb(cfg: Config = config) {
  const client = new (Bun.sql as unknown as new (url: string) => SQL)(buildDatabaseUrl(cfg));
  return drizzle({ client, schema });
}

export async function ping(database: Database): Promise<boolean> {
  try {
    await database.execute('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export const db = createDb();

export type Database = ReturnType<typeof createDb>;
