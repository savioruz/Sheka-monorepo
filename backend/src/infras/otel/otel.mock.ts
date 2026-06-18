import { mock } from 'bun:test';
import type { Scope } from './otel';

export type MockScope = { [K in keyof Scope]: ReturnType<typeof mock> };
export type MockOtel = {
  newScope: ReturnType<typeof mock>;
  shutdown: ReturnType<typeof mock>;
};

export function makeMockOtel(): { otel: MockOtel; scope: MockScope } {
  const scope: MockScope = {
    addEvent: mock(),
    setAttribute: mock(),
    setAttributes: mock(),
    setName: mock(),
    end: mock(),
    traceError: mock(),
    traceIfError: mock(),
  };

  const otel: MockOtel = {
    newScope: mock(() => [{}, scope]),
    shutdown: mock(() => Promise.resolve()),
  };

  return { otel, scope };
}
