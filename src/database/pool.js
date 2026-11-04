import pg from 'pg';

export function createDatabasePool(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    application_name: 'maxicab-api',
  });
  pool.on('error', () => console.error(JSON.stringify({ event: 'database_pool_error' })));
  return pool;
}
