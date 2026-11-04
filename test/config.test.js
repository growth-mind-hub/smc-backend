import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import request from 'supertest';

test('configuration rejects invalid URLs and unsafe production settings', () => {
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'https://localhost' }), /PostgreSQL/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgresql://localhost/db', NODE_ENV: 'production' }), /ADMIN_API_KEY/);
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgresql://localhost/db', PORT: '0' }), /PORT/);
  assert.equal(loadConfig({ DATABASE_URL: 'postgresql://localhost/db', NODE_ENV: 'production', ADMIN_API_KEY: 'a'.repeat(32) }).port, 3000);
});
test('readiness detects database failure while process health remains available', async () => {
  const app = createApp({ logger: { info() {}, error() {} }, vehicleStore: {
    async ready() { throw new Error('offline'); },
  } });
  await request(app).get('/health').expect(200);
  await request(app).get('/ready').expect(503);
});
