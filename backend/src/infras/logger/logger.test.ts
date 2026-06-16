import { describe, expect, test } from 'bun:test';
import { makeMockConfig } from '@config/config.mock';

const mockConfig = makeMockConfig();

describe('Logger', () => {
  test('createLogger should be a function', () => {
    const { createLogger } = require('./logger');
    expect(typeof createLogger).toBe('function');
  });

  test('createLogger should return a logger instance', () => {
    const { createLogger } = require('./logger');

    const logger = createLogger(mockConfig as any);
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.debug).toBe('function');
  });

  test('createLogger should use correct log level from config', () => {
    const { createLogger } = require('./logger');

    const configWithError = { ...mockConfig, log: { level: 'error' } };

    const logger = createLogger(configWithError as any);
    expect(logger.level).toBe('error');
  });

  test('createLogger should use debug level in development', () => {
    const { createLogger } = require('./logger');

    const devConfig = {
      ...mockConfig,
      app: { ...mockConfig.app, env: 'development' },
      log: { level: 'debug' },
    };

    const logger = createLogger(devConfig as any);
    expect(logger.level).toBe('debug');
  });

  test('Logger should have child method', () => {
    const { createLogger } = require('./logger');

    const logger = createLogger(mockConfig as any);
    expect(typeof logger.child).toBe('function');
  });
});
