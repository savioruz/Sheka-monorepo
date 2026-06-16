import type { Database } from '@db/index';
import { ping } from '@db/index';
import type { Hono } from 'hono';
import { error, success } from '../response';

export interface HealthDeps {
  db: Database;
}

export function registerHealthRoutes(app: Hono, deps: HealthDeps) {
  const { db } = deps;

  app.get('/health', async (c) => {
    const databaseConnected = await ping(db);

    if (databaseConnected) {
      return c.json(success({ status: 'ok', uptime: process.uptime(), database: 'connected' }));
    }

    return c.json(error('db_unavailable', 'Unable to connect to database'), 503);
  });
}
