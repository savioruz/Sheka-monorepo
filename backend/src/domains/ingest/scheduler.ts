import type { MarketSync } from '@domains/market/market-sync';
import cron from 'node-cron';
import type { EspnSync } from './espn-sync';

export function scheduleEspnSync(sync: EspnSync, marketSync?: MarketSync) {
  const run = async () => {
    await sync.runOnce();
    // After fresh ESPN data lands, open markets for new games and resolve
    // any whose game just finished.
    if (marketSync) await marketSync.runOnce();
  };

  // Run immediately on startup, then every 15 minutes (ESPN sync + market creation).
  void run();
  cron.schedule('*/15 * * * *', () => {
    void run();
  });

  // Faster settlement: resolve finished markets every minute, decoupled from the
  // 15-min sync. Cheap — it only fetches games whose kickoff has passed, and a
  // re-entrancy guard prevents overlap with the full run.
  if (marketSync) {
    cron.schedule('* * * * *', () => {
      void marketSync.resolveFinishedMarkets();
    });
  }
}
