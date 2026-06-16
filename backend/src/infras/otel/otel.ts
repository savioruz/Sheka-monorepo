import type { Config } from '@config/config';
import type { Logger } from '@infras/logger/logger';
import type { Context } from '@opentelemetry/api';
import { type Span, SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api';
import { OTLPTraceExporter as OTLPGrpcExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { OTLPTraceExporter as OTLPHttpExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export interface Otel {
  newScope(ctx: Context | undefined, scopeName: string, spanName: string): [Context, Scope];
  shutdown(): Promise<void>;
}

export interface Scope {
  end(): void;
  traceError(error: Error): void;
  traceIfError(error: Error | null | undefined): void;
  addEvent(name: string): void;
  setAttribute(key: string, value: unknown): void;
  setAttributes(attributes: Record<string, unknown>): void;
}

class ScopeImpl implements Scope {
  constructor(private readonly span: Span) {}

  end(): void {
    this.span.end();
  }

  traceError(error: Error): void {
    this.span.recordException(error);
    this.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }

  traceIfError(error: Error | null | undefined): void {
    if (error) {
      this.traceError(error);
    }
  }

  addEvent(name: string): void {
    this.span.addEvent(name);
  }

  setAttribute(key: string, value: unknown): void {
    if (typeof value === 'boolean') {
      this.span.setAttribute(key, value);
    } else if (typeof value === 'string') {
      this.span.setAttribute(key, value);
    } else if (typeof value === 'number') {
      this.span.setAttribute(key, value);
    } else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
      this.span.setAttribute(key, value);
    } else {
      this.span.setAttribute(key, String(value));
    }
  }

  setAttributes(attributes: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(attributes)) {
      this.setAttribute(key, value);
    }
  }
}

class OtelImpl implements Otel {
  private sdk: NodeSDK;

  constructor(config: Config, logger: Logger) {
    const protocol = config.otel.protocol || 'grpc';
    let endpoint = config.otel.endpoint || 'localhost:4317';

    let traceExporter: OTLPGrpcExporter | OTLPHttpExporter;
    if (protocol === 'grpc') {
      let grpcEndpoint = endpoint;
      if (grpcEndpoint.startsWith('http://') || grpcEndpoint.startsWith('https://')) {
        grpcEndpoint = grpcEndpoint.replace(/^https?:\/\//, '');
      }
      traceExporter = new OTLPGrpcExporter({
        url: `http://${grpcEndpoint}`,
        timeoutMillis: 30000,
      });
      logger.info(
        { endpoint: grpcEndpoint, protocol: 'grpc', insecure: true },
        'Using OTLP gRPC exporter',
      );
    } else {
      if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
        endpoint = `http://${endpoint}`;
      }
      traceExporter = new OTLPHttpExporter({
        url: `${endpoint}/v1/traces`,
        timeoutMillis: 30000,
      });
      logger.info({ endpoint, protocol: 'http' }, 'Using OTLP HTTP exporter');
    }

    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.app.name,
    });

    this.sdk = new NodeSDK({
      resource,
      spanProcessor: new BatchSpanProcessor(traceExporter),
    });

    this.sdk.start();
    logger.info('OpenTelemetry initialized successfully');
  }

  newScope(_ctx: Context | undefined, scopeName: string, spanName: string): [Context, Scope] {
    const activeCtx = otelContext.active();
    const parentCtx =
      _ctx && typeof (_ctx as Context & { setValue: unknown }).setValue === 'function'
        ? _ctx
        : activeCtx;
    const tracer = trace.getTracer(scopeName);
    const span = tracer.startSpan(spanName, undefined, parentCtx);
    const newCtx = trace.setSpan(parentCtx, span);
    return [newCtx, new ScopeImpl(span)];
  }

  async shutdown(): Promise<void> {
    await this.sdk.shutdown();
  }
}

function createNoopOtel(): Otel {
  const noopScope: Scope = {
    end: () => {},
    traceError: () => {},
    traceIfError: () => {},
    addEvent: () => {},
    setAttribute: () => {},
    setAttributes: () => {},
  };

  return {
    newScope: (ctx: Context) => [ctx, noopScope],
    shutdown: async () => {},
  };
}

export function createOtel(config: Config, logger: Logger): Otel {
  if (!config.otel.enabled) {
    logger.info('OpenTelemetry is disabled');

    return createNoopOtel();
  }

  return new OtelImpl(config, logger);
}
