import { describe, expect, mock, test } from 'bun:test';
import { makeMockConfig } from '@config/config.mock';
import { type IngestorDeps, createIngestor, isPlaceholder, isPlaceholderName } from './ingestor';

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as IngestorDeps['logger'];

describe('isPlaceholder', () => {
  const placeholders = [
    'Group J Winner',
    'Group H 2nd Place',
    'Quarterfinal 3 Winner',
    'Semifinal 1 Loser',
    'Group A Runner-up',
    'TBD',
    'To Be Determined',
    'Round of 16 1 Winner',
  ];
  for (const name of placeholders) {
    test(`TRUE for placeholder "${name}"`, () => {
      expect(isPlaceholderName(name)).toBe(true);
      expect(isPlaceholder(name, 'Argentina')).toBe(true);
      expect(isPlaceholder('Argentina', name)).toBe(true);
    });
  }

  const realTeams = ['Argentina', 'France', 'Los Angeles Lakers', 'Real Madrid'];
  for (const name of realTeams) {
    test(`FALSE for real team "${name}"`, () => {
      expect(isPlaceholderName(name)).toBe(false);
    });
  }

  test('FALSE when both competitors are real teams', () => {
    expect(isPlaceholder('Argentina', 'France')).toBe(false);
  });
});

describe('fetchGames placeholder skip', () => {
  test('creation candidates exclude bracket-placeholder games', async () => {
    const event = (id: string, home: string, away: string) => ({
      espn_id: id,
      sport_slug: 'soccer',
      league_slug: 'fifa.world',
      date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      status: 'scheduled',
      competitors: [
        { home_away: 'home', team: { espn_id: `h${id}`, display_name: home, abbreviation: 'H' } },
        { home_away: 'away', team: { espn_id: `a${id}`, display_name: away, abbreviation: 'A' } },
      ],
    });

    const config = makeMockConfig({
      espn: {
        baseUrl: 'http://espn.test',
        apiKey: '',
        leagues: [{ sport: 'soccer', league: 'fifa.world' }],
      },
    });

    const origFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            count: 2,
            results: [
              event('1', 'Argentina', 'France'),
              event('2', 'Group J Winner', 'Group H 2nd Place'),
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;

    try {
      const ingestor = createIngestor({
        config,
        db: {} as unknown as IngestorDeps['db'],
        logger: silentLogger,
      });
      const games = await ingestor.fetchGames();
      const ids = games.map((g) => g.eventId);
      expect(ids).toContain('1');
      expect(ids).not.toContain('2');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
