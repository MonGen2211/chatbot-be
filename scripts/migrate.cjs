const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const { getPoolConfig } = require('./postgres-config.cjs');
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

async function main() {
  const pool = new Pool(getPoolConfig(process.env.DATABASE_URL, process.env.DATABASE_CA_FILE));
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // A transaction-level lock also works through the transaction pooler.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ai-chat-be:migrations'))");
    await client.query('CREATE SCHEMA IF NOT EXISTS app_private');
    await client.query('REVOKE ALL ON SCHEMA app_private FROM PUBLIC');
    await client.query(`CREATE TABLE IF NOT EXISTS app_private.schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const folder = path.resolve(__dirname, '../migrations');
    for (const name of (await fs.readdir(folder)).filter(name => name.endsWith('.sql')).sort()) {
      const sql = await fs.readFile(path.join(folder, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = await client.query('SELECT checksum FROM app_private.schema_migrations WHERE name = $1', [name]);
      if (previous.rows[0]) {
        if (previous.rows[0].checksum !== checksum) throw new Error('An applied migration was changed; add a new migration instead.');
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO app_private.schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
      console.log(`Prepared migration: ${name}`);
    }
    await client.query('COMMIT');
    console.log('Migration committed. Existing user IDs and chat data preserved.');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    // PostgreSQL error details may include credentials, user rows or password hashes.
    if (error.code) console.error(`Migration failed and rolled back (code ${error.code}).`);
    else console.error(error.message);
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}
main().catch(error => { console.error(error.code ? `Database connection failed (${error.code}).` : error.message); process.exitCode = 1; });
