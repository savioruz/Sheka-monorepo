import { defineConfig } from 'drizzle-kit';

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const host = process.env.DB_POSTGRES_HOST ?? 'localhost';
  const port = process.env.DB_POSTGRES_PORT ?? '5432';
  const name = process.env.DB_POSTGRES_NAME ?? 'sheka';
  const user = process.env.DB_POSTGRES_USER ?? 'postgres';
  const password = process.env.DB_POSTGRES_PASSWORD ?? '';
  const sslMode = process.env.DB_POSTGRES_SSL_MODE ?? 'disable';

  return `postgres://${user}:${encodeURIComponent(password)}@${host}:${port}/${name}?sslmode=${sslMode}`;
}

export default defineConfig({
  schema: './src/db/schema/*',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: getDatabaseUrl(),
  },
});
