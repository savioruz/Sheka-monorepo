import type { Ingestor } from '@domains/prediction/ingestor';
import type { Hono } from 'hono';
import { success } from '../response';

export interface NewsDeps {
  ingestor: Ingestor;
}

export function registerNewsRoutes(app: Hono, deps: NewsDeps) {
  const { ingestor } = deps;

  // Public: recent ESPN news across all ingested leagues (newest-first), for the
  // home-page feed. Best-effort — returns an empty list if ESPN is unavailable.
  app.get('/api/news', async (c) => {
    const limitParam = Number(c.req.query('limit'));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 50) : 24;

    let articles: {
      headline: string;
      description: string;
      published: string | null;
      thumbnail: string | null;
      type: string | null;
      league: string | null;
      sport: string | null;
    }[] = [];
    try {
      const raw = await ingestor.fetchRecentNews(limit);
      articles = raw.map((a) => ({
        headline: a.headline,
        description: a.description ?? '',
        published: a.published ?? null,
        thumbnail: a.thumbnail ?? null,
        type: a.type ?? null,
        league: a.league_slug ?? null,
        sport: a.sport_slug ?? null,
      }));
    } catch {
      /* best-effort: empty list on upstream failure */
    }
    return c.json(success({ articles }));
  });
}
