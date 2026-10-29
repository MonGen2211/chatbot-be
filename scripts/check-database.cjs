const path = require('node:path');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const { getPoolConfig } = require('./postgres-config.cjs');
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });
(async () => {
  const pool = new Pool(getPoolConfig(process.env.DATABASE_URL, process.env.DATABASE_CA_FILE));
  try {
    const { rows } = await pool.query(`SELECT current_database() AS database,
      to_regclass('app_private.users') IS NOT NULL AS auth_migrated,
      to_regclass('public.conversations') IS NOT NULL AS conversations_exist,
      to_regclass('public.messages') IS NOT NULL AS messages_exist`);
    console.log(JSON.stringify(rows[0]));
  } finally { await pool.end(); }
})().catch(error => { console.error(error.code ? `Database check failed (${error.code}).` : error.message); process.exitCode = 1; });
