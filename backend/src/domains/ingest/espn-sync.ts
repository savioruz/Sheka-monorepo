import type { Config } from '@config/config';
import type { Database } from '@db/index';
import { soccerAthletes } from '@db/schema/soccer-athletes';
import type { Logger } from '@infras/logger/logger';
import { context, propagation } from '@opentelemetry/api';
import { eq, sql } from 'drizzle-orm';

export interface EspnSyncDeps {
  config: Config;
  db: Database;
  logger: Logger;
}

interface CoreAthlete {
  id: string;
  fullName?: string;
  displayName?: string;
  position?: { abbreviation?: string };
  team?: { abbreviation?: string };
  statistics?: Record<string, unknown>;
}

interface CoreAthletesResponse {
  athletes?: CoreAthlete[];
}

export function createEspnSync(deps: EspnSyncDeps) {
  const { config, db, logger } = deps;
  const baseUrl = config.espn.baseUrl.replace(/\/$/, '');

  async function postIngest(path: string, body: unknown): Promise<void> {
    const normalizedPath = path.endsWith('/') ? path : `${path}/`;
    const url = `${baseUrl}/api/v1/ingest${normalizedPath}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (config.espn.apiKey) {
      headers['X-API-Key'] = config.espn.apiKey;
    }
    // Propagate the active trace to go-espn-api (W3C `traceparent`).
    propagation.inject(context.active(), headers);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => 'unknown');
        logger.warn({ url, status: response.status, text }, 'ESPN ingest endpoint failed');
      } else {
        logger.info({ url }, 'ESPN ingest endpoint succeeded');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ url, error: message }, 'ESPN ingest endpoint error');
    }
  }

  function formatYyyymmdd(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  async function ingestSoccerFifaWorld(): Promise<void> {
    const sport = 'soccer';
    const league = 'fifa.world';

    // Natural cadence: refresh only today's scoreboard each run.
    // News/injuries/teams are fetched on-demand by the ingestor when a game is analyzed.
    const date = formatYyyymmdd(new Date());
    await postIngest('/scoreboard/', { sport, league, date });
  }

  function buildStatSummary(athlete: CoreAthlete): string {
    const stats = athlete.statistics;
    if (!stats || typeof stats !== 'object') return '';
    const entries: string[] = [];
    for (const [key, value] of Object.entries(stats)) {
      if (key === '$ref') continue;
      entries.push(`${key}: ${String(value)}`);
    }
    return entries.slice(0, 5).join(', ');
  }

  async function syncSoccerAthletes(): Promise<void> {
    const season = new Date().getUTCFullYear().toString();
    const url = 'https://sports.core.api.espn.com/v3/sports/soccer/fifa.world/athletes?limit=500';

    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) {
        logger.warn({ url, status: response.status }, 'Core API v3 athletes fetch failed');
        return;
      }

      const data = (await response.json()) as CoreAthletesResponse;
      const athletes = data.athletes ?? [];

      await db.transaction(async (tx) => {
        for (const athlete of athletes) {
          const espnId = String(athlete.id);
          const name = athlete.fullName ?? athlete.displayName ?? 'Unknown';
          const summary = buildStatSummary(athlete);
          if (!summary) continue;

          const existing = await tx
            .select({ id: soccerAthletes.id })
            .from(soccerAthletes)
            .where(eq(soccerAthletes.espnAthleteId, espnId))
            .limit(1);

          const values = {
            espnAthleteId: espnId,
            athleteName: name,
            teamAbbreviation: athlete.team?.abbreviation ?? null,
            position: athlete.position?.abbreviation ?? null,
            season,
            statSummary: summary,
            rawJson: JSON.stringify(athlete),
            updatedAt: new Date(),
          };

          if (existing.length > 0) {
            await tx
              .update(soccerAthletes)
              .set(values)
              .where(eq(soccerAthletes.id, existing[0].id));
          } else {
            await tx.insert(soccerAthletes).values({ ...values, createdAt: new Date() });
          }
        }
      });

      logger.info({ count: athletes.length }, 'Soccer athletes synced');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ url, error: message }, 'Soccer athletes sync error');
    }
  }

  async function runOnce(): Promise<void> {
    logger.info('Starting ESPN soccer sync');
    await ingestSoccerFifaWorld();
    await syncSoccerAthletes();
  }

  return { runOnce, ingestSoccerFifaWorld, syncSoccerAthletes };
}

export type EspnSync = ReturnType<typeof createEspnSync>;
