import { describe, expect, test } from 'bun:test';
import { loadConfig } from './config';

describe('Config', () => {
  test('loads with required env vars', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.DEEPBOOK_PACKAGE_ID = '0x0';
    process.env.DEEPBOOK_PREDICT_OBJECT_ID = '0x0';
    process.env.DEEPBOOK_REGISTRY_ID = '0x0';
    process.env.OTEL_ENABLED = 'false';

    const cfg = loadConfig();
    expect(cfg.app.name).toBe('sheka');
    expect(cfg.app.port).toBe(3001);
    expect(cfg.app.minConfidence).toBe('medium');
    expect(cfg.espn.baseUrl).toBe('https://test.espn.judice.fun');
    expect(cfg.otel.enabled).toBe(false);
  });

  test('minConfidence can be overridden', () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    process.env.DEEPBOOK_PACKAGE_ID = '0x0';
    process.env.DEEPBOOK_PREDICT_OBJECT_ID = '0x0';
    process.env.DEEPBOOK_REGISTRY_ID = '0x0';
    process.env.MIN_CONFIDENCE = 'high';

    const cfg = loadConfig();
    expect(cfg.app.minConfidence).toBe('high');
  });
});
