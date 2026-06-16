import type { Config } from './config';

export function makeMockConfig(overrides?: Partial<Config>): Config {
  return {
    app: {
      name: 'sheka-test',
      port: 3001,
      env: 'test',
      minConfidence: 'medium',
      baseUrl: 'http://localhost:3001',
    },
    cors: {
      enabled: false,
      allowCredentials: true,
      allowedHeaders: [],
      allowedMethods: [],
      allowedOrigins: [],
      maxAge: 300,
    },
    openrouter: {
      apiKey: 'test-key',
      baseUrl: 'https://test.openrouter.ai/api/v1',
      model: 'anthropic/claude-sonnet-4-6',
    },
    sui: {
      rpcUrl: 'https://fullnode.testnet.sui.io:443',
      network: 'testnet',
    },
    dusdc: {
      type: '0x0::dusdc::DUSDC',
      currencyId: '0x0',
      decimals: 6,
    },
    espn: {
      baseUrl: 'https://test.espn.judice.fun',
      apiKey: '',
    },
    walrus: {
      gatewayUrl: 'https://aggregator.walrus-testnet.walrus.space/v1',
    },
    database: {
      host: 'localhost',
      port: 5432,
      name: 'sheka_test',
      user: 'postgres',
      password: '',
      sslMode: 'disable',
    },
    otel: {
      enabled: false,
      protocol: 'grpc',
      endpoint: 'localhost:4317',
    },
    log: {
      level: 'silent',
    },
    ...overrides,
  } as Config;
}
