import type { Context } from 'hono';

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
}

function deepToSnake<T>(value: T): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepToSnake(item));
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[camelToSnake(k)] = deepToSnake(v);
    }
    return result;
  }
  return value;
}

export function success<T>(data: T): { data: unknown } {
  return { data: deepToSnake(data) };
}

export function error(errorKey: string, message: string): { error: string; message: string } {
  return { error: errorKey, message };
}

export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  limit: number,
  domainKey: string,
): { data: Record<string, unknown> } {
  return {
    data: {
      [domainKey]: deepToSnake(items),
      total,
      page,
      limit,
    },
  };
}
