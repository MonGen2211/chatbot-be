const fs = require('node:fs');
const path = require('node:path');

function getPoolConfig(databaseUrl, caFile = '') {
  if (!databaseUrl || /YOUR[-_]PASSWORD/i.test(databaseUrl)) {
    throw new Error('Fill DATABASE_URL with your real database password in ai-chat-be/.env.');
  }
  let url;
  try { url = new URL(databaseUrl); }
  catch { throw new Error('DATABASE_URL is invalid. Check URL-encoding of the password.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use PostgreSQL.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const mode = url.searchParams.get('sslmode');
  if (mode === 'disable' && !local) throw new Error('Remote PostgreSQL connections must use TLS.');
  const caPath = caFile || url.searchParams.get('sslrootcert');
  // Prevent URL parsing from overriding the verified TLS options below.
  for (const name of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey']) url.searchParams.delete(name);
  const ssl = local && (!mode || mode === 'disable') ? false : {
    rejectUnauthorized: true,
    ...(caPath ? { ca: fs.readFileSync(path.resolve(__dirname, '..', caPath), 'utf8') } : {}),
  };
  return {
    connectionString: url.toString(), ssl,
    max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
    statement_timeout: 15000, query_timeout: 16000,
  };
}
module.exports = { getPoolConfig };
