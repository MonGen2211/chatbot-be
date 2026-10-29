import { Pool, types, type PoolConfig, type QueryResultRow } from 'pg';
import { env } from './env';
import { databaseError } from '../repositories/database-error';

const { getPoolConfig } = require('../../scripts/postgres-config.cjs') as {
  getPoolConfig: (url: string, caFile: string) => PoolConfig;
};
types.setTypeParser(1184, value => new Date(value).toISOString());
export const pool = new Pool(getPoolConfig(env.databaseUrl, env.databaseCaFile));
pool.on('error', () => console.error('PostgreSQL idle connection failed.'));
export async function query<Row extends QueryResultRow>(db: Pool, operation: string, text: string, values: unknown[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  try {
    const result = await db.query<Row>(text, values);
    signal?.throwIfAborted();
    return result;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    throw databaseError(operation, error as { code?: string; message?: string });
  }
}
