import type { Config } from '@config/config';
import type { Database } from '@db/index';
import { soccerAthletes } from '@db/schema/soccer-athletes';
import type { Logger } from '@infras/logger/logger';
import { context, propagation } from '@opentelemetry/api';
import { eq } from 'drizzle-orm';

import type { GameSnapshot, Sport, TeamSnapshot } from './types';

interface ESPNEventList {
  id: number;
  espn_id: string;
  name: string;
  short_name?: string;
  date: string;
  status: string;
  status_detail?: string;
  sport_slug: string;
  league_slug: string;
  venue_name?: string;
  competitors?: ESPNCompetitor[];
}

interface ESPNEvent extends ESPNEventList {
  clock?: string;
  period?: number;
  venue?: {
    name?: string;
    city?: string;
    indoor?: boolean;
  };
  competitors: ESPNCompetitor[];
}

interface ESPNCompetitor {
  id: number;
  home_away: 'home' | 'away';
  score?: string;
  score_int?: number;
  team: ESPNTeam;
  athletes?: ESPNAthlete[];
  records?: Record<string, unknown>;
}

interface ESPNTeam {
  espn_id: string;
  display_name: string;
  abbreviation: string;
  location?: string;
  name?: string;
  primary_logo?: string;
}

interface ESPNAthlete {
  id: number;
  espn_id?: string;
  full_name?: string;
  display_name?: string;
}

interface ESPNNewsArticle {
  id?: number;
  espn_id?: string;
  headline: string;
  description?: string;
  published?: string;
  type?: string;
  thumbnail?: string;
  league_slug?: string | null;
  sport_slug?: string | null;
  // Present on the detail endpoint only.
  links?: { web?: { href?: string } } & Record<string, unknown>;
  images?: Array<{ url?: string }>;
}

interface ESPNInjury {
  athlete_espn_id?: string;
  athlete_name?: string;
  status?: string;
  position?: string;
  injury_type?: string;
  return_date?: string;
  description?: string;
}

interface ESPNAthleteStat {
  athlete_espn_id?: string;
  athlete_name?: string;
  stat_summary?: string;
  minutes_per_game?: number;
  points_per_game?: number;
}

interface ESPNApiResponse<T> {
  count: number;
  results: T[];
}

export interface IngestorDeps {
  config: Config;
  db: Database;
  logger: Logger;
}

const INJURY_STATUSES = new Set(['out', 'doubtful', 'ir', 'questionable', 'day_to_day']);

const GAMES_CACHE_TTL_MS = 60_000;

function statusRank(status: string): number {
  if (status === 'in_progress') return 0; // Live
  if (status === 'scheduled') return 1; // Upcoming
  return 2; // Finished / other
}

// Order: Live → Upcoming (soonest first) → Finished (most recent first).
function compareGames(a: GameSnapshot, b: GameSnapshot): number {
  const ra = statusRank(a.status);
  const rb = statusRank(b.status);
  if (ra !== rb) return ra - rb;
  const ta = new Date(a.scheduledAt).getTime();
  const tb = new Date(b.scheduledAt).getTime();
  return ra === 2 ? tb - ta : ta - tb;
}

interface ESPNSport {
  id: number;
  slug: string;
  name: string;
}

/**
 * Pick news relevant to a match: keep articles whose headline/description mention
 * any of the given team terms (name/abbreviation), newest-first as returned.
 * Falls back to the full list when fewer than `min` match (common for tournaments
 * like fifa.world where per-team coverage is sparse).
 */
export function pickRelevantNews<T extends { headline?: string; description?: string }>(
  articles: T[],
  teamTerms: (string | null | undefined)[],
  opts: { min?: number; limit?: number } = {},
): T[] {
  const { min = 2, limit = 6 } = opts;
  const terms = teamTerms.filter((t): t is string => Boolean(t)).map((t) => t.toLowerCase());
  const relevant = articles.filter((a) => {
    const hay = `${a.headline ?? ''} ${a.description ?? ''}`.toLowerCase();
    return terms.some((t) => hay.includes(t));
  });
  return (relevant.length >= min ? relevant : articles).slice(0, limit);
}

// Generic words that appear in many team names (and bracket placeholders) and so
// make poor, over-broad search terms on their own.
const TEAM_NAME_STOPWORDS = new Set([
  'fc',
  'sc',
  'ac',
  'afc',
  'cf',
  'cd',
  'club',
  'city',
  'united',
  'real',
  'town',
  'county',
  'athletic',
  'atletico',
  'sporting',
  'deportivo',
  'the',
  'and',
  'de',
  'of',
  // World Cup / playoff bracket placeholders (e.g. "Quarterfinal 3 Winner").
  'winner',
  'loser',
  'group',
  'round',
  'final',
  'quarterfinal',
  'semifinal',
  'playoff',
]);

/**
 * Distinctive search tokens for a team display name, for ESPN's token-AND search.
 * Drops generic/short words ("Manchester United" → ["manchester"]; "Kansas City
 * Chiefs" → ["kansas", "chiefs"]; "Sweden" → ["sweden"]). Returns [] when nothing
 * distinctive remains (e.g. a bracket placeholder like "Round of 16 1 Winner").
 */
export function teamSearchTerms(displayName: string | null | undefined): string[] {
  if (typeof displayName !== 'string') return [];
  const tokens = displayName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !TEAM_NAME_STOPWORDS.has(t) && !/^\d+$/.test(t));
  return [...new Set(tokens)];
}

export function createIngestor(deps: IngestorDeps) {
  const { config, db, logger } = deps;
  const baseUrl = config.espn.baseUrl.replace(/\/$/, '');

  let gamesCache: { data: GameSnapshot[]; expiresAt: number } | null = null;

  async function fetchJson<T>(path: string): Promise<T | null> {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {};
    if (config.espn.apiKey) {
      headers['X-API-Key'] = config.espn.apiKey;
    }
    // Propagate the active trace to go-espn-api (W3C `traceparent`). Bun's native
    // fetch is not reliably auto-instrumented, so inject explicitly.
    propagation.inject(context.active(), headers);

    // The upstream ESPN service is occasionally flaky (5xx / timeouts); retry a
    // couple of times with short backoff before giving up.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          return (await response.json()) as T;
        }
        const body = await response.text().catch(() => '');
        const retriable = response.status >= 500;
        logger.warn(
          { url, status: response.status, attempt, body: body.slice(0, 200) },
          'ESPN fetch failed',
        );
        if (!retriable || attempt === maxAttempts) return null;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ url, error: message, attempt }, 'ESPN fetch error');
        if (attempt === maxAttempts) return null;
      }
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
    return null;
  }

  async function fetchRawGamesForSport(sport: Sport, league: string): Promise<ESPNEventList[]> {
    const now = new Date();
    // Window: yesterday → upcoming. The ESPN API rejects comma-separated `status`
    // (only single values are valid), so we omit it and filter status client-side.
    // date_from/date_to must be plain YYYY-MM-DD dates (ISO datetimes are rejected).
    const toDate = (d: Date) => d.toISOString().slice(0, 10);
    const dateFrom = toDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const dateTo = toDate(new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000));

    const params = new URLSearchParams({
      sport,
      league,
      date_from: dateFrom,
      date_to: dateTo,
      // Soonest-first. The endpoint defaults to -date (farthest-future first) and
      // returns one page (25), so for big competitions (e.g. World Cup, 79 events)
      // the near-term games fall off page 1 and never become markets. Ascending
      // puts today's/imminent games on page 1.
      ordering: 'date',
    });

    const data = await fetchJson<ESPNApiResponse<ESPNEventList>>(
      `/api/v1/events/?${params.toString()}`,
    );
    logger.info(
      { sport, league, count: data?.results?.length ?? 0 },
      'Fetched ESPN games for sport',
    );
    return data?.results ?? [];
  }

  async function fetchEventDetail(eventId: number): Promise<ESPNEvent | null> {
    return fetchJson<ESPNEvent>(`/api/v1/events/${eventId}/`);
  }

  async function fetchEventDetailByEspnId(espnEventId: string): Promise<ESPNEvent | null> {
    return fetchJson<ESPNEvent>(`/api/v1/events/espn/${espnEventId}/`);
  }

  async function fetchSports(): Promise<ESPNSport[]> {
    const data = await fetchJson<ESPNApiResponse<ESPNSport>>('/api/v1/sports/');
    return data?.results ?? [];
  }

  // ESPN news is PageNumberPagination (25/page). Fetch a single page (1-indexed).
  async function fetchNewsPage(
    page: number,
    opts: { sport?: string; league?: string; search?: string } = {},
  ): Promise<ESPNApiResponse<ESPNNewsArticle>> {
    const params = new URLSearchParams({ page: String(page) });
    if (opts.sport) params.set('sport', opts.sport);
    if (opts.league) params.set('league', opts.league);
    if (opts.search) params.set('search', opts.search);
    const data = await fetchJson<ESPNApiResponse<ESPNNewsArticle>>(
      `/api/v1/news/?${params.toString()}`,
    );
    return data ?? { count: 0, results: [] };
  }

  async function fetchNewsForSport(
    sport: Sport,
    league: string,
    opts: { search?: string } = {},
  ): Promise<ESPNNewsArticle[]> {
    const data = await fetchNewsPage(1, { sport, league, search: opts.search });
    return data.results;
  }

  // Recent news for the home feed / news page, sliced to [offset, offset+limit).
  // ESPN pages are 25 wide, so we fetch only the page(s) overlapping the window.
  // `filters` (search/sport/league) are forwarded to ESPN. `total` is the full
  // filtered result count (for paging).
  const NEWS_PAGE_SIZE = 25;
  async function fetchRecentNews(
    offset = 0,
    limit = 8,
    filters: { search?: string; sport?: string; league?: string } = {},
  ): Promise<{ articles: ESPNNewsArticle[]; hasMore: boolean; total: number }> {
    const startPage = Math.floor(offset / NEWS_PAGE_SIZE) + 1;
    const endPage = Math.floor((offset + limit - 1) / NEWS_PAGE_SIZE) + 1;
    let count = 0;
    const collected: ESPNNewsArticle[] = [];
    for (let page = startPage; page <= endPage; page++) {
      const data = await fetchNewsPage(page, filters);
      // The window can spill past the last ESPN page (pages are 25 wide), and an
      // out-of-range page 404s → { count: 0 }. Don't let that clobber the real
      // total, and stop once a page yields nothing.
      if (data.count > 0) count = data.count;
      collected.push(...data.results);
      if (data.results.length === 0) break;
    }
    const sliceStart = offset - (startPage - 1) * NEWS_PAGE_SIZE;
    const articles = collected.slice(sliceStart, sliceStart + limit);
    return { articles, hasMore: offset + limit < count, total: count };
  }

  // News relevant to a match. We search ESPN per team and union the results
  // (newest-first). Key detail: ESPN's search AND-matches the whitespace-split
  // tokens, so the full display name ("Kansas City Chiefs") almost never matches
  // a short headline ("Chiefs win") — and no single token position is reliable
  // across sports ("Broncos" → many hits, "Denver" → none). So we search EACH
  // distinctive token per team and union; every hit therefore contains a team
  // token within the sport+league, which keeps results on-topic. When nothing
  // distinctive matches we return [] rather than padding with generic league
  // news the user did not ask for.
  async function fetchRelevantNews(
    sport: Sport,
    league: string,
    teamTerms: (string | null | undefined)[],
    limit = 8,
  ): Promise<ESPNNewsArticle[]> {
    const searchTerms = new Set<string>();
    for (const team of teamTerms) {
      for (const term of teamSearchTerms(team)) searchTerms.add(term);
    }
    if (searchTerms.size === 0) return [];

    const perTerm = await Promise.all(
      [...searchTerms].map((term) =>
        fetchNewsForSport(sport, league, { search: term }).catch(() => []),
      ),
    );
    const byKey = new Map<string, ESPNNewsArticle>();
    for (const a of perTerm.flat()) byKey.set(String(a.id ?? a.espn_id ?? a.headline), a);
    return [...byKey.values()]
      .sort((a, b) => new Date(b.published ?? 0).getTime() - new Date(a.published ?? 0).getTime())
      .slice(0, limit);
  }

  // Full detail for one article (adds links/images). Returns null if not found.
  async function fetchNewsDetail(id: string | number): Promise<ESPNNewsArticle | null> {
    return fetchJson<ESPNNewsArticle>(`/api/v1/news/${id}/`);
  }

  async function fetchInjuriesForTeam(abbreviation: string): Promise<ESPNInjury[]> {
    const params = new URLSearchParams({ team: abbreviation });
    const data = await fetchJson<ESPNApiResponse<ESPNInjury>>(
      `/api/v1/injuries/?${params.toString()}`,
    );
    return data?.results ?? [];
  }

  async function fetchAthleteStats(
    sport: Sport,
    league: string,
    season: string,
    athleteIds: string[],
  ): Promise<ESPNAthleteStat[]> {
    if (sport === 'soccer') {
      const idSet = new Set(athleteIds);
      const rows = await db
        .select({
          espnAthleteId: soccerAthletes.espnAthleteId,
          athleteName: soccerAthletes.athleteName,
          statSummary: soccerAthletes.statSummary,
        })
        .from(soccerAthletes)
        .where(eq(soccerAthletes.season, season));

      return rows
        .filter((r) => idSet.size === 0 || idSet.has(r.espnAthleteId))
        .map((r) => ({
          athlete_espn_id: r.espnAthleteId,
          athlete_name: r.athleteName,
          stat_summary: r.statSummary,
        }));
    }

    const params = new URLSearchParams({ sport, league, season });
    const data = await fetchJson<ESPNApiResponse<ESPNAthleteStat>>(
      `/api/v1/athlete-stats/?${params.toString()}`,
    );
    const all = data?.results ?? [];
    if (athleteIds.length === 0) return all;
    const idSet = new Set(athleteIds);
    return all.filter((s) => s.athlete_espn_id && idSet.has(s.athlete_espn_id));
  }

  function extractAthleteIds(competitor: ESPNCompetitor): string[] {
    const athletes = competitor.athletes ?? [];
    return athletes
      .map((a) => a.espn_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
  }

  function normalizeTeam(
    competitor: ESPNCompetitor,
    injuries: ESPNInjury[],
    stats: ESPNAthleteStat[],
  ): TeamSnapshot {
    const team = competitor.team;
    const score = competitor.score_int ?? null;

    return {
      espnId: team.espn_id,
      displayName: team.display_name,
      abbreviation: team.abbreviation,
      logo: team.primary_logo,
      score,
      injuries: injuries
        .filter((i) => i.status && INJURY_STATUSES.has(i.status.toLowerCase()))
        .map((i) => ({
          athleteEspnId: i.athlete_espn_id ?? '',
          athleteName: i.athlete_name ?? 'Unknown',
          status: i.status ?? 'out',
          position: i.position,
          injuryType: i.injury_type,
          returnDate: i.return_date,
          description: i.description,
        })),
      keyStats: stats
        .filter((s) => s.athlete_espn_id)
        .slice(0, 3)
        .map((s) => ({
          athleteEspnId: s.athlete_espn_id ?? '',
          athleteName: s.athlete_name ?? 'Unknown',
          statSummary: s.stat_summary ?? '',
        })),
    };
  }

  // Lightweight builder for the games LIST: uses only the list item (no per-game
  // detail/injuries/news/stats fetches). The list endpoint already carries
  // competitors, scores, venue_name and status — everything the list UI needs.
  function normalizeGameFromList(event: ESPNEventList): GameSnapshot | null {
    const comps = event.competitors ?? [];
    const homeComp = comps.find((c) => c.home_away === 'home');
    const awayComp = comps.find((c) => c.home_away === 'away');
    if (!homeComp || !awayComp) return null;

    return {
      eventId: event.espn_id,
      sport: event.sport_slug as Sport,
      league: event.league_slug,
      scheduledAt: event.date,
      status: event.status as GameSnapshot['status'],
      statusDetail: event.status_detail,
      period: null,
      clock: null,
      venue: event.venue_name ? { name: event.venue_name, city: null } : null,
      homeTeam: normalizeTeam(homeComp, [], []),
      awayTeam: normalizeTeam(awayComp, [], []),
      recentNews: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  async function normalizeGame(event: ESPNEventList): Promise<GameSnapshot | null> {
    const detail = await fetchEventDetail(event.id);
    if (!detail) return null;

    const homeComp = detail.competitors?.find((c) => c.home_away === 'home');
    const awayComp = detail.competitors?.find((c) => c.home_away === 'away');
    if (!homeComp || !awayComp) return null;

    const [news, homeInjuries, awayInjuries, allStats] = await Promise.all([
      fetchNewsForSport(event.sport_slug as Sport, event.league_slug),
      fetchInjuriesForTeam(homeComp.team.abbreviation),
      fetchInjuriesForTeam(awayComp.team.abbreviation),
      fetchAthleteStats(
        event.sport_slug as Sport,
        event.league_slug,
        new Date(event.date).getUTCFullYear().toString(),
        [...extractAthleteIds(homeComp), ...extractAthleteIds(awayComp)],
      ),
    ]);

    const homeAthleteIds = new Set(extractAthleteIds(homeComp));
    const homeStats = allStats.filter(
      (s) => s.athlete_espn_id && homeAthleteIds.has(s.athlete_espn_id),
    );
    const awayStats = allStats.filter(
      (s) => s.athlete_espn_id && !homeAthleteIds.has(s.athlete_espn_id),
    );

    // The news API has no team filter, so prefer articles that mention either
    // team; fall back to league-wide recent when few match (common for fifa.world).
    const chosenNews = pickRelevantNews(
      news,
      [
        homeComp.team.display_name,
        homeComp.team.abbreviation,
        awayComp.team.display_name,
        awayComp.team.abbreviation,
      ],
      { limit: 6 },
    );

    return {
      eventId: event.espn_id,
      sport: event.sport_slug as Sport,
      league: event.league_slug,
      scheduledAt: event.date,
      status: event.status as GameSnapshot['status'],
      statusDetail: event.status_detail,
      period: detail.period ?? null,
      clock: detail.clock ?? null,
      venue: detail.venue
        ? {
            name: detail.venue.name ?? event.venue_name ?? '',
            city: detail.venue.city ?? null,
            isIndoor: detail.venue.indoor,
          }
        : event.venue_name
          ? { name: event.venue_name, city: null }
          : null,
      homeTeam: normalizeTeam(homeComp, homeInjuries, homeStats),
      awayTeam: normalizeTeam(awayComp, awayInjuries, awayStats),
      recentNews: chosenNews.map((n) => ({
        headline: n.headline,
        description: n.description ? n.description.slice(0, 200) : undefined,
        published: n.published,
      })),
      fetchedAt: new Date().toISOString(),
    };
  }

  async function filterTradeable(games: GameSnapshot[]): Promise<GameSnapshot[]> {
    const now = new Date();

    return games.filter((game) => {
      if (game.status === 'postponed' || game.status === 'cancelled') return false;

      if (game.status === 'scheduled') {
        const start = new Date(game.scheduledAt);
        const diffMinutes = (start.getTime() - now.getTime()) / 1000 / 60;
        // Allow games from up to 1 day ago through any upcoming date (no live games today).
        if (diffMinutes < -24 * 60) return false;
      }

      return true;
    });
  }

  async function fetchGames(): Promise<GameSnapshot[]> {
    if (gamesCache && Date.now() < gamesCache.expiresAt) {
      return gamesCache.data;
    }

    const settled = await Promise.allSettled(
      config.espn.leagues.map(async ({ sport, league }) => {
        const raw = await fetchRawGamesForSport(sport, league);
        // Build straight from list items — no per-game detail/secondary fetches.
        return raw.map(normalizeGameFromList);
      }),
    );

    const allGames: GameSnapshot[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        allGames.push(...result.value.filter((g): g is GameSnapshot => g !== null));
      }
    }

    const tradeable = (await filterTradeable(allGames)).sort(compareGames);
    // Don't cache empty results — a transient upstream 500 must not poison the
    // cache for the full TTL.
    if (tradeable.length > 0) {
      gamesCache = { data: tradeable, expiresAt: Date.now() + GAMES_CACHE_TTL_MS };
    }
    return tradeable;
  }

  async function fetchGameContext(
    espnEventId: string,
    sport: Sport,
    league: string,
  ): Promise<GameSnapshot | null> {
    // The upstream /events/espn/{id}/ endpoint is unreliable (intermittent 500s).
    // Resolve via the list endpoint first (it works and carries sport/league
    // slugs), then fall back to the by-espn-id lookup. normalizeGame re-fetches
    // detail by internal id, which is the reliable path.
    let event: ESPNEventList | null =
      (await fetchRawGamesForSport(sport, league)).find((e) => e.espn_id === espnEventId) ?? null;
    if (!event) {
      event = await fetchEventDetailByEspnId(espnEventId);
    }
    if (!event) return null;

    const normalized = await normalizeGame(event);
    if (!normalized) return null;

    if (normalized.sport !== sport || normalized.league !== league) {
      return { ...normalized, sport, league };
    }

    return normalized;
  }

  /**
   * Best-effort: ask the ESPN service to re-ingest a date's scoreboard. Used to
   * nudge a stuck/stale game (frozen `in_progress`) toward `final`. No-op if the
   * upstream itself is frozen. Errors are swallowed.
   */
  async function refreshScoreboard(sport: Sport, league: string, date: Date): Promise<void> {
    const yyyymmdd = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
      date.getUTCDate(),
    ).padStart(2, '0')}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (config.espn.apiKey) headers['X-API-Key'] = config.espn.apiKey;
    propagation.inject(context.active(), headers);
    try {
      await fetch(`${baseUrl}/api/v1/ingest/scoreboard/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sport, league, date: yyyymmdd }),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      /* best-effort */
    }
  }

  return {
    fetchGames,
    fetchSports,
    fetchGameContext,
    refreshScoreboard,
    fetchRelevantNews,
    fetchRecentNews,
    fetchNewsDetail,
  };
}

export type Ingestor = ReturnType<typeof createIngestor>;
