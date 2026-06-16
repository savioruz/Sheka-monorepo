import { z } from 'zod';
import { env, envArray, envBool, envNum } from './env';

const configSchema = z.object({
  app: z.object({
    name: z.string().default('sheka'),
    port: z.number().default(3001),
    env: z.enum(['development', 'production', 'test']).default('development'),
    minConfidence: z.enum(['low', 'medium', 'high']).default('medium'),
    baseUrl: z.string().default('http://localhost:3001'),
  }),
  cors: z.object({
    enabled: z.boolean().default(true),
    allowCredentials: z.boolean().default(true),
    allowedHeaders: z.array(z.string()).default([]),
    allowedMethods: z.array(z.string()).default([]),
    allowedOrigins: z.array(z.string()).default([]),
    maxAge: z.number().default(300),
  }),
  openrouter: z.object({
    apiKey: z.string().min(1, 'OPENROUTER_API_KEY is required'),
    baseUrl: z.string().default('https://openrouter.ai/api/v1'),
    model: z.string().default('anthropic/claude-sonnet-4-6'),
  }),
  sui: z.object({
    rpcUrl: z.string().default('https://fullnode.testnet.sui.io:443'),
    network: z.string().default('testnet'),
  }),
  dusdc: z.object({
    type: z.string().min(1, 'DUSDC_TYPE is required'),
    currencyId: z.string().min(1, 'DUSDC_CURRENCY_ID is required'),
    decimals: z.number().default(6),
  }),
  market: z.object({
    packageId: z.string().min(1, 'SHEKA_MARKET_PACKAGE_ID is required'),
    adminCapId: z.string().min(1, 'SHEKA_MARKET_ADMIN_CAP_ID is required'),
    adminAddress: z.string().default(''),
    // Max markets auto-created per ESPN sync run (bounds on-chain gas).
    autoCreateLimit: z.number().default(8),
  }),
  analysis: z.object({
    packageId: z.string().min(1, 'SHEKA_ANALYSIS_PACKAGE_ID is required'),
    registryId: z.string().min(1, 'SHEKA_ANALYSIS_REGISTRY_ID is required'),
    treasuryId: z.string().min(1, 'SHEKA_ANALYSIS_TREASURY_ID is required'),
    quotaId: z.string().min(1, 'SHEKA_ANALYSIS_QUOTA_ID is required'),
    adminCapId: z.string().min(1, 'SHEKA_ANALYSIS_ADMIN_CAP_ID is required'),
    adminAddress: z.string().default(''),
    autoModelId: z.number().default(0),
    freeLimit: z.number().default(3),
  }),
  espn: z.object({
    baseUrl: z.string().default('http://localhost:8000'),
    apiKey: z.string().default(''),
    // Sport/league pairs to ingest; configurable via INGEST_LEAGUES env.
    leagues: z.array(z.object({ sport: z.string(), league: z.string() })).default([
      { sport: 'basketball', league: 'nba' },
      { sport: 'football', league: 'nfl' },
      { sport: 'soccer', league: 'fifa.world' },
    ]),
  }),
  walrus: z.object({
    gatewayUrl: z.string().default('https://aggregator.walrus-testnet.walrus.space/v1'),
    publisherUrl: z.string().default('https://publisher.walrus-testnet.walrus.space'),
    epochs: z.number().default(5),
  }),
  database: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(5432),
    name: z.string().default('sheka'),
    user: z.string().default('postgres'),
    password: z.string().default(''),
    sslMode: z.string().default('disable'),
  }),
  otel: z.object({
    enabled: z.boolean().default(true),
    protocol: z.enum(['grpc', 'http']).default('grpc'),
    endpoint: z.string().default('localhost:4317'),
  }),
  log: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),
});

export type Config = z.infer<typeof configSchema>;

// Parse "sport:league,sport:league" → [{ sport, league }]
function parseLeagues(raw: string): Array<{ sport: string; league: string }> {
  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [sport, league] = pair.split(':').map((s) => s.trim());
      return { sport, league };
    })
    .filter((p) => p.sport && p.league);
}

export function loadConfig(): Config {
  const defaultConfig: Config = {
    app: {
      name: env('APP_NAME', 'sheka'),
      port: envNum('APP_PORT', 3001),
      env:
        (env('APP_ENV', 'development') as 'development' | 'production' | 'test') || 'development',
      minConfidence: (env('MIN_CONFIDENCE', 'medium') as 'low' | 'medium' | 'high') || 'medium',
      baseUrl: env('BASE_URL', 'http://localhost:3001'),
    },
    cors: {
      enabled: envBool('CORS_ENABLED', true),
      allowCredentials: envBool('CORS_ALLOW_CREDENTIALS', true),
      allowedHeaders: envArray('CORS_ALLOWED_HEADERS'),
      allowedMethods: envArray('CORS_ALLOWED_METHODS'),
      allowedOrigins: envArray('CORS_ALLOWED_ORIGINS'),
      maxAge: envNum('CORS_MAX_AGE_SECONDS', 300),
    },
    openrouter: {
      apiKey: env('OPENROUTER_API_KEY'),
      baseUrl: env('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
      model: env('OPENROUTER_MODEL', 'anthropic/claude-sonnet-4-6'),
    },
    sui: {
      rpcUrl: env('SUI_RPC_URL', 'https://fullnode.testnet.sui.io:443'),
      network: env('SUI_NETWORK', 'testnet'),
    },
    dusdc: {
      type: env('DUSDC_TYPE', ''),
      currencyId: env('DUSDC_CURRENCY_ID', ''),
      decimals: envNum('DUSDC_DECIMALS', 6),
    },
    market: {
      packageId: env('SHEKA_MARKET_PACKAGE_ID', ''),
      adminCapId: env('SHEKA_MARKET_ADMIN_CAP_ID', ''),
      adminAddress: env('SHEKA_MARKET_ADMIN_ADDRESS', ''),
      autoCreateLimit: envNum('SHEKA_MARKET_AUTO_CREATE_LIMIT', 8),
    },
    analysis: {
      packageId: env('SHEKA_ANALYSIS_PACKAGE_ID', ''),
      registryId: env('SHEKA_ANALYSIS_REGISTRY_ID', ''),
      treasuryId: env('SHEKA_ANALYSIS_TREASURY_ID', ''),
      quotaId: env('SHEKA_ANALYSIS_QUOTA_ID', ''),
      adminCapId: env('SHEKA_ANALYSIS_ADMIN_CAP_ID', ''),
      adminAddress: env('SHEKA_MARKET_ADMIN_ADDRESS', ''),
      autoModelId: envNum('SHEKA_ANALYSIS_AUTO_MODEL_ID', 0),
      freeLimit: envNum('SHEKA_ANALYSIS_FREE_LIMIT', 3),
    },
    espn: {
      baseUrl: env('ESPN_API_BASE_URL', 'https://test.espn.judice.fun'),
      apiKey: env('ESPN_API_KEY', ''),
      leagues: parseLeagues(env('INGEST_LEAGUES', 'basketball:nba,football:nfl,soccer:fifa.world')),
    },
    walrus: {
      gatewayUrl: env('WALRUS_GATEWAY_URL', 'https://aggregator.walrus-testnet.walrus.space/v1'),
      publisherUrl: env('WALRUS_PUBLISHER_URL', 'https://publisher.walrus-testnet.walrus.space'),
      epochs: envNum('WALRUS_EPOCHS', 5),
    },
    database: {
      host: env('DB_POSTGRES_HOST', 'localhost'),
      port: envNum('DB_POSTGRES_PORT', 5432),
      name: env('DB_POSTGRES_NAME', 'sheka'),
      user: env('DB_POSTGRES_USER', 'postgres'),
      password: env('DB_POSTGRES_PASSWORD', ''),
      sslMode: env('DB_POSTGRES_SSL_MODE', 'disable'),
    },
    otel: {
      enabled: envBool('OTEL_ENABLED', true),
      protocol: (env('OTEL_PROTOCOL', 'grpc') as 'grpc' | 'http') || 'grpc',
      endpoint: env('OTEL_ENDPOINT', 'localhost:4317'),
    },
    log: {
      level: (env('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error') || 'info',
    },
  };

  return configSchema.parse(defaultConfig);
}

export const config = loadConfig();
