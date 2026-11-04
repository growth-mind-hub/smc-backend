import pg from 'pg';
import { migrate } from './migrate.js';

if (!process.env.DATABASE_URL) {throw new Error('DATABASE_URL is required.');}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await migrate(pool);
  console.info('Database migrations complete.');
} finally {
  await pool.end();
}
