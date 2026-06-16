import { describe, expect, test } from 'bun:test';
import { makeMockConfig } from '@config/config.mock';
import { createAnalyst } from './analyst';

const mockConfig = makeMockConfig();

describe('Analyst', () => {
  test('analyst exposes analyzeGame', () => {
    const analyst = createAnalyst({ config: mockConfig });
    expect(analyst.analyzeGame).toBeFunction();
  });
});
