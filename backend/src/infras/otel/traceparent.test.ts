import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { makeMockConfig } from '@config/config.mock';
import { createEspnSync } from '@domains/ingest/espn-sync';
import { createIngestor } from '@domains/prediction/ingestor';
import { context, propagation, trace } from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/;

// Register a real tracer provider + W3C propagator, mirroring what otel.ts wires
// at boot. Without this the global propagator is a no-op and `context.active()`
// carries no span, so there is nothing to inject.
const provider = new NodeTracerProvider();

beforeAll(() => {
  provider.register({
    propagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  });
});

afterAll(async () => {
  await provider.shutdown();
});

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

const fakeDb = {} as any;

describe('traceparent propagation', () => {
  const originalFetch = globalThis.fetch;
  let captured: { url: string; headers: Record<string, string> } | null = null;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    captured = null;
  });

  function stubFetch(jsonBody: unknown) {
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      captured = { url, headers: (init?.headers ?? {}) as Record<string, string> };
      return Promise.resolve(
        new Response(JSON.stringify(jsonBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }) as any;
  }

  test('inject writes a W3C traceparent carrying the active trace id', () => {
    trace.getTracer('traceparent-test').startActiveSpan('unit', (span) => {
      const headers: Record<string, string> = { 'X-API-Key': 'secret' };
      propagation.inject(context.active(), headers);

      expect(headers['X-API-Key']).toBe('secret'); // unrelated header preserved
      expect(headers.traceparent).toMatch(TRACEPARENT_RE);
      expect(headers.traceparent?.split('-')[1]).toBe(span.spanContext().traceId);
      span.end();
    });
  });

  test('ingestor fetchJson (GET) carries traceparent to go-espn-api', async () => {
    const config = makeMockConfig({
      espn: { baseUrl: 'https://espn.test', apiKey: 'k', leagues: [] },
    });
    const ingestor = createIngestor({ config, db: fakeDb, logger: noopLogger });

    stubFetch({ results: [] });

    await trace.getTracer('test').startActiveSpan('req', async (span) => {
      await ingestor.fetchSports();
      const traceparent = captured?.headers.traceparent;
      expect(traceparent).toMatch(TRACEPARENT_RE);
      expect(traceparent?.split('-')[1]).toBe(span.spanContext().traceId);
      expect(captured?.headers['X-API-Key']).toBe('k'); // api key still set
      span.end();
    });
  });

  test('espn-sync postIngest (POST) carries traceparent to go-espn-api', async () => {
    const config = makeMockConfig({
      espn: { baseUrl: 'https://espn.test', apiKey: 'k', leagues: [] },
    });
    const sync = createEspnSync({ config, db: fakeDb, logger: noopLogger });

    stubFetch({ ok: true });

    await trace.getTracer('test').startActiveSpan('req', async (span) => {
      await sync.ingestSoccerFifaWorld();
      const traceparent = captured?.headers.traceparent;
      expect(traceparent).toMatch(TRACEPARENT_RE);
      expect(traceparent?.split('-')[1]).toBe(span.spanContext().traceId);
      expect(captured?.headers['Content-Type']).toBe('application/json'); // preserved
      span.end();
    });
  });
});
