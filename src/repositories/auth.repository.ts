import { pool, query } from '../config/database';
import { databaseError } from './database-error';
import { HttpError } from '../middlewares/error.middleware';
export interface AuthUser {
  id: string; email: string | null; password_hash: string | null;
  email_verified: boolean; banned_until: string | null; deleted_at: string | null; token_version: number;
}
const columns = 'id, email, password_hash, email_verified, banned_until, deleted_at, token_version';
export async function findUserByEmail(email: string): Promise<AuthUser | undefined> {
  return (await query<AuthUser>(pool, 'users.findByEmail',
    `SELECT ${columns} FROM app_private.users WHERE lower(email) = lower($1)`, [email])).rows[0];
}
export async function findUserById(id: string): Promise<AuthUser | undefined> {
  return (await query<AuthUser>(pool, 'users.findById',
    `SELECT ${columns} FROM app_private.users WHERE id = $1`, [id])).rows[0];
}
export async function createUser(email: string, passwordHash: string): Promise<AuthUser> {
  const client = await pool.connect().catch(error => { throw databaseError('users.connect', error); });
  try {
    await client.query('BEGIN');
    const result = await client.query<AuthUser>(
      `INSERT INTO app_private.users (email, password_hash, email_verified)
       VALUES (lower($1), $2, true) RETURNING ${columns}`, [email, passwordHash]);
    const user = result.rows[0];
    await client.query('INSERT INTO public.profiles (id) VALUES ($1)', [user.id]);
    await client.query('COMMIT');
    return user;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if ((error as { code?: string }).code === '23505') throw new HttpError(409, 'Email đã được đăng ký.', 'email_exists');
    throw databaseError('users.create', error as { code?: string; message?: string });
  } finally { client.release(); }
}
