import { createNonceManager } from '@auth/nonce';
import { createVerifier } from '@auth/verify';
import type { Config } from '@config/config';
import type { Database } from '@db/index';
import type { AnalysisService } from '@domains/analysis/service';
import { createCryptoAnalyst } from '@domains/crypto/crypto-analyst';
import { createCryptoNews } from '@domains/crypto/crypto-news';
import { createPredictClient } from '@domains/crypto/predict-client';
import type { MarketService } from '@domains/market/service';
import type { Analyst } from '@domains/prediction/analyst';
import type { Ingestor } from '@domains/prediction/ingestor';
import type { Logger } from '@infras/logger/logger';
import type { Otel } from '@infras/otel/otel';
import { createAuthMiddleware } from '@middleware/auth';
import { createTracingMiddleware } from '@middleware/tracing';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { registerAnalysisRoutes } from './handler/analysis';
import { registerNonceRoutes } from './handler/auth/nonce';
import { registerVerifyRoutes } from './handler/auth/verify';
import { registerCryptoRoutes } from './handler/crypto';
import { registerGamesRoutes } from './handler/games';
import { registerHealthRoutes } from './handler/health';
import { registerMarketsRoutes } from './handler/markets';
import { registerNewsRoutes } from './handler/news';
import { registerSportsRoutes } from './handler/sports';
import { createOpenAPIRouter } from './openapi';

export interface ServerDeps {
  config: Config;
  logger: Logger;
  otel: Otel;
  db: Database;
  ingestor: Ingestor;
  analyst: Analyst;
  marketService: MarketService;
  analysisService: AnalysisService;
}

export function createServer(deps: ServerDeps): Hono {
  const { config, logger, otel, db, ingestor, analyst, marketService, analysisService } = deps;

  const nonceManager = createNonceManager({ db });
  const verifier = createVerifier({ db, nonceManager, suiRpcUrl: config.sui.rpcUrl });
  const predictClient = createPredictClient({ config, logger });
  const cryptoNews = createCryptoNews({ logger });
  const cryptoAnalyst = createCryptoAnalyst({ config, logger });
  const authMiddleware = createAuthMiddleware({ verifier });

  const app = new Hono();

  if (config.cors.enabled) {
    app.use(
      cors({
        origin: config.cors.allowedOrigins.length > 0 ? config.cors.allowedOrigins : '*',
        allowMethods:
          config.cors.allowedMethods.length > 0
            ? config.cors.allowedMethods
            : ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders:
          config.cors.allowedHeaders.length > 0
            ? config.cors.allowedHeaders
            : ['Content-Type', 'Authorization', 'X-Request-ID'],
        credentials: config.cors.allowCredentials,
        maxAge: config.cors.maxAge,
      }),
    );
  }

  app.use(createTracingMiddleware(otel));

  registerHealthRoutes(app, { db });
  registerGamesRoutes(app, { ingestor });
  registerSportsRoutes(app, { ingestor });
  registerNewsRoutes(app, { ingestor });

  // Auth-gated subpaths MUST be declared before the routes they protect — Hono
  // only applies `app.use` to handlers registered after it. The crypto analyze
  // gate therefore has to come before registerCryptoRoutes.
  app.use('/api/crypto/markets/:oracleId/analyze', authMiddleware);
  registerCryptoRoutes(app, { predictClient, cryptoNews, cryptoAnalyst, analysisService, db });
  registerNonceRoutes(app, { nonceManager });
  registerVerifyRoutes(app, { verifier });

  app.use('/api/markets/:id/analyze', authMiddleware);
  app.use('/api/analysis/quota', authMiddleware);
  app.use('/api/analysis/mine', authMiddleware);

  registerAnalysisRoutes(app, { config, db, analysisService });
  registerMarketsRoutes(app, { db, marketService, ingestor, analyst, analysisService });

  if (config.app.env === 'development') {
    createOpenAPIRouter(app);
  }

  app.onError((err, c) => {
    logger.error({ error: err.message, path: c.req.path }, 'Unhandled error');
    return c.json({ error: 'internal_error', message: 'Internal server error' }, 500);
  });

  return app;
}
