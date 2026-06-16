import { config } from '@config/config';
import { createDb } from '@db/index';
import { createAnalysisService } from '@domains/analysis/service';
import { createEspnSync } from '@domains/ingest/espn-sync';
import { scheduleEspnSync } from '@domains/ingest/scheduler';
import { createMarketSync } from '@domains/market/market-sync';
import { createMarketService } from '@domains/market/service';
import { createAnalyst } from '@domains/prediction/analyst';
import { createIngestor } from '@domains/prediction/ingestor';
import { createLogger } from '@infras/logger/logger';
import { createOtel } from '@infras/otel/otel';
import { createServer } from '@transport/http/server';

async function main() {
  const otel = createOtel(config, createLogger(config));
  const logger = createLogger(config);

  try {
    const db = createDb(config);
    const ingestor = createIngestor({ config, db, logger });
    const analyst = createAnalyst({ config });
    const marketService = createMarketService({ config, logger });
    const analysisService = createAnalysisService({ config, logger, db });
    await analysisService.seedModels();

    const marketSync = createMarketSync({ config, db, logger, ingestor, marketService });
    const espnSync = createEspnSync({ config, db, logger });
    scheduleEspnSync(espnSync, marketSync);

    const app = createServer({
      config,
      logger,
      otel,
      db,
      ingestor,
      analyst,
      marketService,
      analysisService,
    });

    const server = Bun.serve({
      port: config.app.port,
      idleTimeout: 180, // LLM analysis / ESPN fetches can exceed the 10s default
      fetch: app.fetch,
    });

    logger.info(`Server running at http://localhost:${server.port}`);

    const shutdown = async () => {
      logger.info('Shutting down...');
      server.stop();
      await otel.shutdown();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

main();
