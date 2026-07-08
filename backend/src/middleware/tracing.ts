import { randomUUID } from "node:crypto";
import type { Otel } from "@infras/otel/otel";
import { context as otelContext, propagation } from "@opentelemetry/api";
import type { Context, Next } from "hono";

export function createTracingMiddleware(otel: Otel) {
  return async function tracingMiddleware(c: Context, next: Next) {
    const requestId = c.req.header("x-request-id") ?? randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-ID", requestId);

    const parentCtx = propagation.extract(otelContext.active(), c.req.header());

    const [ctx, span] = otelContext.with(parentCtx, () =>
      otel.newScope(undefined, "http-request", `${c.req.method} ${c.req.path}`),
    );
    span.setAttributes({
      "http.method": c.req.method,
      "http.target": c.req.url,
      "request.id": requestId,
    });

    try {
      // Activate the request span's context so `traced(...)` child spans created
      // in handlers nest under it (otherwise Jaeger shows only this parent span).
      await otelContext.with(ctx, () => next());
      // Use the templated route (e.g. /api/crypto/markets/:oracleId/analyze) instead
      // of the concrete path so Jaeger groups by operation, not by every oracle id.
      const route = c.req.routePath ?? c.req.path;
      span.setName(`${c.req.method} ${route}`);
      span.setAttributes({
        "http.route": route,
        "http.status_code": c.res.status,
      });
    } catch (error) {
      span.traceError(
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    } finally {
      span.end();
    }
  };
}
