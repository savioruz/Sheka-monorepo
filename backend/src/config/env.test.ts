import { beforeEach, describe, expect, test } from 'bun:test';
import { env, envArray, envBool, envNum } from './env';

describe('env', () => {
  beforeEach(() => {
    // biome-ignore lint/performance/noDelete: test cleanup
    delete process.env.TEST_KEY;
    // biome-ignore lint/performance/noDelete: test cleanup
    delete process.env.TEST_BOOL;
    // biome-ignore lint/performance/noDelete: test cleanup
    delete process.env.TEST_NUM;
    // biome-ignore lint/performance/noDelete: test cleanup
    delete process.env.TEST_ARRAY;
  });

  describe('env()', () => {
    test('should return value when env var exists', () => {
      process.env.TEST_KEY = 'test-value';
      expect(env('TEST_KEY')).toBe('test-value');
    });

    test('should return default value when env var does not exist', () => {
      expect(env('TEST_KEY', 'default')).toBe('default');
    });

    test('should return empty string when env var and default do not exist', () => {
      expect(env('TEST_KEY')).toBe('');
    });
  });

  describe('envBool()', () => {
    test('should return true for "true"', () => {
      process.env.TEST_BOOL = 'true';
      expect(envBool('TEST_BOOL')).toBe(true);
    });

    test('should return true for "1"', () => {
      process.env.TEST_BOOL = '1';
      expect(envBool('TEST_BOOL')).toBe(true);
    });

    test('should return false for "false"', () => {
      process.env.TEST_BOOL = 'false';
      expect(envBool('TEST_BOOL')).toBe(false);
    });

    test('should return default value when env var does not exist', () => {
      expect(envBool('TEST_BOOL', true)).toBe(true);
    });
  });

  describe('envNum()', () => {
    test('should return number for valid number string', () => {
      process.env.TEST_NUM = '123';
      expect(envNum('TEST_NUM')).toBe(123);
    });

    test('should return default value when env var does not exist', () => {
      expect(envNum('TEST_NUM', 42)).toBe(42);
    });

    test('should return 0 when env var is empty string', () => {
      process.env.TEST_NUM = '';
      expect(envNum('TEST_NUM')).toBe(0);
    });
  });

  describe('envArray()', () => {
    test('should return array for comma-separated values', () => {
      process.env.TEST_ARRAY = 'a,b,c';
      expect(envArray('TEST_ARRAY')).toEqual(['a', 'b', 'c']);
    });

    test('should trim whitespace from values', () => {
      process.env.TEST_ARRAY = 'a, b , c';
      expect(envArray('TEST_ARRAY')).toEqual(['a', 'b', 'c']);
    });

    test('should return empty array when env var does not exist', () => {
      expect(envArray('TEST_ARRAY')).toEqual([]);
    });

    test('should use custom separator', () => {
      process.env.TEST_ARRAY = 'a|b|c';
      expect(envArray('TEST_ARRAY', '|')).toEqual(['a', 'b', 'c']);
    });
  });
});
