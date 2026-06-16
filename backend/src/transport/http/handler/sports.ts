import type { Ingestor } from '@domains/prediction/ingestor';
import type { Hono } from 'hono';
import { error, success } from '../response';

export interface SportsDeps {
  ingestor: Ingestor;
}

export function registerSportsRoutes(app: Hono, deps: SportsDeps) {
  const { ingestor } = deps;

  app.get('/api/sports', async (c) => {
    try {
      const sports = await ingestor.fetchSports();
      return c.json(success({ sports, fetchedAt: new Date().toISOString() }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(error('espn_unavailable', message), 503);
    }
  });
}
