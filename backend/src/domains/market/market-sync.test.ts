import { describe, expect, mock, test } from 'bun:test';
import { makeMockConfig } from '@config/config.mock';
import {
  type MarketSyncDeps,
  createMarketSync,
  decideVoidOutcome,
  voidMarketByPools,
  winnerFromScore,
} from './market-sync';

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as MarketSyncDeps['logger'];

describe('winnerFromScore', () => {
  test('home/draw/away', () => {
    expect(winnerFromScore(2, 1)).toBe(0);
    expect(winnerFromScore(1, 1)).toBe(1);
    expect(winnerFromScore(0, 3)).toBe(2);
  });
});

describe('decideVoidOutcome', () => {
  test('no stake anywhere → void to outcome 1', () => {
    expect(decideVoidOutcome([0, 0, 0])).toEqual({ kind: 'void', winner: 1 });
  });

  test('empty outcome present → refund via that outcome', () => {
    expect(decideVoidOutcome([10, 0, 5])).toEqual({ kind: 'refund', winner: 1 });
  });

  test('first empty outcome is chosen', () => {
    expect(decideVoidOutcome([0, 4, 5])).toEqual({ kind: 'refund', winner: 0 });
  });

  test('stake on every outcome → cannot void', () => {
    expect(decideVoidOutcome([3, 4, 5])).toEqual({ kind: 'cannot' });
  });
});

describe('voidMarketByPools', () => {
  test('empty outcome → resolves to it (refund)', async () => {
    const resolveMarket = mock(async () => 'digest-refund');
    const marketService = {
      getMarketState: mock(async () => ({ pools: [10, 0, 5], total: 15, status: 0, winner: 255 })),
      resolveMarket,
    };
    const result = await voidMarketByPools(marketService, 'm1');
    expect(resolveMarket).toHaveBeenCalledTimes(1);
    expect(resolveMarket).toHaveBeenCalledWith('m1', 1);
    expect(result).toEqual({ status: 'refunded', winner: 1, digest: 'digest-refund' });
  });

  test('no stake → resolves to outcome 1 (void)', async () => {
    const resolveMarket = mock(async () => 'digest-void');
    const marketService = {
      getMarketState: mock(async () => ({ pools: [0, 0, 0], total: 0, status: 0, winner: 255 })),
      resolveMarket,
    };
    const result = await voidMarketByPools(marketService, 'm2');
    expect(resolveMarket).toHaveBeenCalledWith('m2', 1);
    expect(result).toEqual({ status: 'voided', winner: 1, digest: 'digest-void' });
  });

  test('all outcomes staked → resolveMarket NOT called', async () => {
    const resolveMarket = mock(async () => 'nope');
    const marketService = {
      getMarketState: mock(async () => ({ pools: [3, 4, 5], total: 12, status: 0, winner: 255 })),
      resolveMarket,
    };
    const result = await voidMarketByPools(marketService, 'm3');
    expect(resolveMarket).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'cannot' });
  });

  test('no on-chain state → resolveMarket NOT called', async () => {
    const resolveMarket = mock(async () => 'nope');
    const marketService = {
      getMarketState: mock(async () => null),
      resolveMarket,
    };
    const result = await voidMarketByPools(marketService, 'm4');
    expect(resolveMarket).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'no_state' });
  });
});

// A drizzle-query stub for the two shapes resolveFinishedMarketsInner uses:
//   db.select().from(x).where(y)  → open rows
//   db.update(x).set(y).where(z)  → no-op
function fakeDb(openRows: unknown[]) {
  return {
    select: () => ({ from: () => ({ where: async () => openRows }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  } as unknown as MarketSyncDeps['db'];
}

function nonFinalGame() {
  return {
    eventId: 'evt-1',
    sport: 'soccer',
    league: 'fifa.world',
    scheduledAt: new Date().toISOString(),
    status: 'in_progress',
    statusDetail: '2nd Half',
    period: 2,
    clock: "70'",
    venue: null,
    homeTeam: {
      displayName: 'A',
      abbreviation: 'A',
      espnId: 'a',
      score: 1,
      injuries: [],
      keyStats: [],
    },
    awayTeam: {
      displayName: 'B',
      abbreviation: 'B',
      espnId: 'b',
      score: 1,
      injuries: [],
      keyStats: [],
    },
    recentNews: [],
    fetchedAt: new Date().toISOString(),
  };
}

function marketRow(hoursAgo: number) {
  return {
    marketObjectId: 'obj-1',
    eventId: 'evt-1',
    sport: 'soccer',
    league: 'fifa.world',
    status: 'open',
    scheduledAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
    homeLogo: 'x',
    awayLogo: 'y',
    winner: null,
  };
}

function makeDeps(row: ReturnType<typeof marketRow>, resolveMarket: ReturnType<typeof mock>) {
  const config = makeMockConfig({
    market: {
      packageId: '0x0',
      adminCapId: '0x0',
      adminAddress: '',
      autoCreateLimit: 8,
      stuckVoidHours: 24,
    },
  });
  const refreshScoreboard = mock(async () => {});
  const markVoided = mock(async () => {});
  return {
    deps: {
      config,
      db: fakeDb([row]),
      logger: silentLogger,
      ingestor: {
        fetchGameContext: mock(async () => nonFinalGame()),
        refreshScoreboard,
      } as unknown as MarketSyncDeps['ingestor'],
      marketService: {
        getMarketState: mock(async () => ({
          pools: [10, 0, 5],
          total: 15,
          status: 0,
          winner: 255,
        })),
        resolveMarket,
        markVoided,
      } as unknown as MarketSyncDeps['marketService'],
    },
    refreshScoreboard,
    markVoided,
  };
}

describe('resolveFinishedMarkets stuck-market auto-void', () => {
  test('market 25h past kickoff, non-final → auto-void path invoked', async () => {
    const resolveMarket = mock(async () => 'void-digest');
    const { deps, markVoided } = makeDeps(marketRow(25), resolveMarket);
    const sync = createMarketSync(deps);
    await sync.resolveFinishedMarkets();
    expect(resolveMarket).toHaveBeenCalledTimes(1);
    expect(resolveMarket).toHaveBeenCalledWith('obj-1', 1);
    expect(markVoided).toHaveBeenCalledWith('obj-1', 1, 'void-digest');
  });

  test('market 3h past kickoff, non-final → NOT voided', async () => {
    const resolveMarket = mock(async () => 'nope');
    const { deps, markVoided, refreshScoreboard } = makeDeps(marketRow(3), resolveMarket);
    const sync = createMarketSync(deps);
    await sync.resolveFinishedMarkets();
    expect(resolveMarket).not.toHaveBeenCalled();
    expect(markVoided).not.toHaveBeenCalled();
    // 3h < 4h stale grace, so no re-ingest nudge either.
    expect(refreshScoreboard).not.toHaveBeenCalled();
  });
});
