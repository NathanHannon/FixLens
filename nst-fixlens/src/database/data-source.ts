import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { entities } from './entities.js';
import { Initial1791900000000 } from './migrations/1791900000000-Initial.js';
import { Calibration1793059200000 } from './migrations/1793059200000-Calibration.js';

const migrations = [Initial1791900000000, Calibration1793059200000];

/**
 * Single source of truth for Postgres connection options.
 * Used by both the Nest runtime (via AppModule) and the TypeORM CLI
 * (via the default DataSource export below).
 *
 * Env:
 * - DATABASE_URL (postgres:// or postgresql://, password embedded as
 *   userinfo, e.g. postgresql://user:pass@host:5432/db?sslmode=require).
 *   When absent, it is assembled from the discrete managed-DB variables:
 * - DATABASE_HOST, DATABASE_USERNAME, DATABASE_PASSWORD, DATABASE_NAME
 *   (required fallback), DATABASE_PORT (default 5432)
 * - DB_SSL ("true" to force TLS, or ?sslmode=require in the URL;
 *   DATABASE_SSL="require" also honored for managed-DB .env files)
 * - DATABASE_CERT / DB_SSL_CA (path to CA cert, e.g. DigitalOcean's CA)
 * - DB_SSL_REJECT_UNAUTHORIZED ("false" to accept self-signed certs)
 * - DB_POOL_MAX (pg pool size, default 10)
 * - DB_LOGGING ("true" to enable TypeORM query logging)
 */
export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const direct = (env.DATABASE_URL ?? '').trim();
  if (direct) return direct;

  const host = (env.DATABASE_HOST ?? '').trim();
  const name = (env.DATABASE_NAME ?? '').trim();
  const username = (env.DATABASE_USERNAME ?? '').trim();
  const password = (env.DATABASE_PASSWORD ?? '').trim();
  const port = (env.DATABASE_PORT ?? '').trim() || '5432';
  if (!host || !name || !username || !password) {
    throw new Error(
      'Missing required environment variable: DATABASE_URL ' +
        '(or DATABASE_HOST, DATABASE_NAME, DATABASE_USERNAME and DATABASE_PASSWORD)',
    );
  }
  const sslRequested =
    env.DB_SSL === 'true' ||
    env.DATABASE_SSL === 'require' ||
    env.DATABASE_SSL === 'true';
  return (
    `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}` +
    `@${host}:${port}/${encodeURIComponent(name)}${sslRequested ? '?sslmode=require' : ''}`
  );
}

export function buildDataSourceOptions(
  env: NodeJS.ProcessEnv = process.env,
): DataSourceOptions {
  const url = resolveDatabaseUrl(env);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL must be a valid URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must use postgres:// or postgresql://');
  }

  const sslRequested =
    env.DB_SSL === 'true' ||
    env.DATABASE_SSL === 'require' ||
    env.DATABASE_SSL === 'true' ||
    parsed.searchParams.get('sslmode') === 'require';
  // Strip sslmode before handing the URL to TypeORM: pg-connection-string
  // turns ?sslmode=require into `ssl: true`, which overwrites our `ssl`
  // object (with the CA) when the driver merges parsed URL over options.
  // TLS is driven solely by the `ssl` object below. (Also silences pg's
  // sslmode-alias deprecation warning.)
  parsed.searchParams.delete('sslmode');
  const connectionUrl = parsed.toString();
  const certPath = env.DATABASE_CERT ?? env.DB_SSL_CA;
  let sslCa: string | undefined;
  if (certPath) {
    try {
      sslCa = readFileSync(certPath, 'utf8');
    } catch {
      throw new Error(
        `Could not read TLS CA cert at ${certPath} (set by DATABASE_CERT). ` +
          'Check the path relative to the backend working directory.',
      );
    }
  }
  const poolMax = Number(env.DB_POOL_MAX ?? 10);

  return {
    type: 'postgres',
    url: connectionUrl,
    entities,
    migrations,
    synchronize: false,
    migrationsRun: false,
    uuidExtension: 'pgcrypto',
    logging: env.DB_LOGGING === 'true',
    ...(sslRequested || sslCa
      ? {
          ssl: {
            ...(sslCa ? { ca: sslCa } : {}),
            rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
          },
        }
      : {}),
    extra: {
      max: Number.isInteger(poolMax) && poolMax > 0 ? poolMax : 10,
      connectionTimeoutMillis: 10_000,
    },
  };
}

// TypeORM CLI entrypoint: `typeorm -d dist/database/data-source.js`
export default new DataSource(buildDataSourceOptions());
