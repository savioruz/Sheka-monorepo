import { randomUUID } from 'node:crypto';
import type { Otel } from '@infras/otel/otel';
import type { Context, Next } from 'hono';

export function createTracingMiddleware(otel: Otel) {
  return async function tracingMiddleware(c: Context, next: Next) {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-ID', requestId);

    const [, span] = otel.newScope(undefined, 'http-request', `${c.req.method} ${c.req.path}`);
    span.setAttributes({
      'http.method': c.req.method,
      'http.route': c.req.path,
      'http.target': c.req.url,
      'request.id': requestId,
    });

    try {
      await next();
      span.setAttributes({ 'http.status_code': c.res.status });
    } catch (error) {
      span.traceError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  };
}
