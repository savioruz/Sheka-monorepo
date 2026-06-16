import type { Context as HonoContext } from 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
    walletAddress: string;
  }
}

export type Context = HonoContext;
