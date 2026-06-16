import type { Ingestor } from '@domains/prediction/ingestor';
import type { GameSnapshot } from '@domains/prediction/types';
import type { Hono } from 'hono';
import { error, success } from '../response';

export interface GamesDeps {
  ingestor: Ingestor;
}

interface GameSummary {
  espn_event_id: string;
  sport: string;
  league: string;
  name: string;
  short_name: string;
  status: string;
  scheduled_at: string;
  period: number | null;
  clock: string | null;
  home_team: {
    espn_id: string;
    display_name: string;
    abbreviation: string;
    score: number | null;
  };
  away_team: {
    espn_id: string;
    display_name: string;
    abbreviation: string;
    score: number | null;
  };
  venue: { name: string; city: string | null } | null;
}

function toGameSummary(game: GameSnapshot): GameSummary {
  return {
    espn_event_id: game.eventId,
    sport: game.sport,
    league: game.league,
    name: `${game.homeTeam.displayName} vs ${game.awayTeam.displayName}`,
    short_name: `${game.homeTeam.abbreviation} vs ${game.awayTeam.abbreviation}`,
    status: game.status,
    scheduled_at: game.scheduledAt,
    period: game.period,
    clock: game.clock,
    home_team: {
      espn_id: game.homeTeam.espnId,
      display_name: game.homeTeam.displayName,
      abbreviation: game.homeTeam.abbreviation,
      score: game.homeTeam.score,
    },
    away_team: {
      espn_id: game.awayTeam.espnId,
      display_name: game.awayTeam.displayName,
      abbreviation: game.awayTeam.abbreviation,
      score: game.awayTeam.score,
    },
    venue: game.venue ? { name: game.venue.name, city: game.venue.city } : null,
  };
}

export function registerGamesRoutes(app: Hono, deps: GamesDeps) {
  const { ingestor } = deps;

  app.get('/api/games', async (c) => {
    try {
      const games = await ingestor.fetchGames();
      const summaries = games.map(toGameSummary);
      return c.json(success({ games: summaries, fetched_at: new Date().toISOString() }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json(error('espn_unavailable', message), 503);
    }
  });
}
