import type { Ingestor } from '@domains/prediction/ingestor';
import { traced } from '@infras/otel/otel';
import type { Hono } from 'hono';
import { error, success } from '../response';

export interface NewsDeps {
  ingestor: Ingestor;
}

export function registerNewsRoutes(app: Hono, deps: NewsDeps) {
  const { ingestor } = deps;

  // Public: recent ESPN news across all leagues (newest-first), paginated for the
  // home feed's infinite scroll. Best-effort — empty list if ESPN is unavailable.
  app.get('/api/news', async (c) => {
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    const limitRaw = Number(c.req.query('limit'));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 24) : 8;
    const search = c.req.query('search')?.trim() || undefined;
    const sport = c.req.query('sport')?.trim() || undefined;
    const league = c.req.query('league')?.trim() || undefined;

    try {
      const { articles, hasMore, total } = await traced('news.fetchRecent', () =>
        ingestor.fetchRecentNews(offset, limit, { search, sport, league }),
      );
      return c.json(
        success({
          articles: articles.map((a) => ({
            id: a.id ?? null,
            headline: a.headline,
            description: a.description ?? '',
            published: a.published ?? null,
            thumbnail: a.thumbnail ?? null,
            type: a.type ?? null,
            league: a.league_slug ?? null,
            sport: a.sport_slug ?? null,
          })),
          has_more: hasMore,
          total,
        }),
      );
    } catch {
      return c.json(success({ articles: [], has_more: false, total: 0 }));
    }
  });

  // Public: one article's detail (adds image + outbound ESPN link).
  app.get('/api/news/:id', async (c) => {
    const id = c.req.param('id');
    const a = await traced('news.fetchDetail', () => ingestor.fetchNewsDetail(id));
    if (!a) return c.json(error('not_found', 'Article not found'), 404);
    return c.json(
      success({
        article: {
          id: a.id ?? null,
          headline: a.headline,
          description: a.description ?? '',
          published: a.published ?? null,
          image: a.images?.[0]?.url ?? a.thumbnail ?? null,
          type: a.type ?? null,
          league: a.league_slug ?? null,
          sport: a.sport_slug ?? null,
          url: a.links?.web?.href ?? null,
        },
      }),
    );
  });
}
