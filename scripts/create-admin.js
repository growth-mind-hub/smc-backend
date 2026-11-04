import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { createDatabasePool } from '../src/database/pool.js';
import { hashPassword } from '../src/modules/admin/password.js';

if (!process.env.DATABASE_URL) { throw new Error('DATABASE_URL is required.'); }
if (!process.stdin.isTTY) { throw new Error('Run admin:create in an interactive terminal.'); }
const username = process.argv[2];
if (!username || username.length > 100 || username.trim() !== username) {
  throw new Error('Usage: npm run admin:create -- <username> (1–100 characters, no surrounding spaces).');
}
let hidden = false;
const output = new Writable({ write(chunk, _encoding, callback) {
  if (!hidden) { process.stdout.write(chunk); }
  callback();
} });
const prompt = createInterface({ input: process.stdin, output, terminal: true });
let password;
try {
  process.stdout.write('Password (hidden): ');
  hidden = true;
  password = await prompt.question('');
  process.stdout.write('\nConfirm password (hidden): ');
  const confirmation = await prompt.question('');
  process.stdout.write('\n');
  if (password !== confirmation) { throw new Error('Passwords do not match.'); }
  if (password.length < 12 || password.length > 1024) { throw new Error('Password must contain 12–1024 characters.'); }
} finally { prompt.close(); }
const pool = createDatabasePool(process.env.DATABASE_URL);
try {
  await pool.query('INSERT INTO admin_users (username, password_hash) VALUES ($1, $2)',
    [username, await hashPassword(password)]);
  console.info('Admin account created.');
} catch (err) {
  console.error(err.code === '23505' ? 'That admin username already exists.'
    : 'Could not create admin account. Verify database connectivity and run migrations.');
  process.exitCode = 1;
} finally { await pool.end(); }
