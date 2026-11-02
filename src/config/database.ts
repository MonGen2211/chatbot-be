import { Pool, types, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';
import { env } from './env';
import { databaseError } from '../repositories/database-error';
import { HttpError } from '../middlewares/error.middleware';

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

export async function transaction<T>(db: Pool, operation: string, work: (client: PoolClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const client = await db.connect().catch(error => { throw databaseError(operation, error); });
  try {
    await client.query('BEGIN');
    const result = await work(client);
    signal?.throwIfAborted();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (signal?.aborted) throw signal.reason;
    if (error instanceof HttpError) throw error;
    throw databaseError(operation, error as { code?: string; message?: string });
  } finally { client.release(); }
}
