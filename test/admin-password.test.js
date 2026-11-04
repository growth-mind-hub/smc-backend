import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/modules/admin/password.js';
import { adminRepository } from '../src/modules/admin/admin.repository.js';

test('password hashes use distinct salts and reject incorrect passwords and malformed hashes', async () => {
  const hash = await hashPassword('long-test-password');
  assert.notEqual(hash, await hashPassword('long-test-password'));
  assert.equal(await verifyPassword('long-test-password', hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.equal(await verifyPassword('wrong', 'invalid'), false);
});

test('database authentication uses parameterized lookup and rejects missing or disabled accounts', async () => {
  const passwordHash = await hashPassword('long-test-password');
  let user = { id: 7, password_hash: passwordHash, is_active: true };
  const repo = adminRepository({ async query(sql, values) {
    assert.match(sql, /username = \$1/);
    assert.deepEqual(values, ['admin']);
    return { rows: user ? [user] : [] };
  } });
  assert.deepEqual(await repo.authenticateAdmin('admin', 'long-test-password'), { id: 7 });
  assert.equal(await repo.authenticateAdmin('admin', 'wrong'), null);
  user.is_active = false;
  assert.equal(await repo.authenticateAdmin('admin', 'long-test-password'), null);
  user = null;
  assert.equal(await repo.authenticateAdmin('admin', 'long-test-password'), null);
});

test('database errors do not leak credentials in login responses', async () => {
  const { createApp } = await import('../src/app.js');
  const { default: request } = await import('supertest');
  const app = createApp({ adminApiKey: '', logger: { info() {}, error() {} }, vehicleStore: {
    async authenticateAdmin() { throw new Error('private database details'); },
  } });
  const response = await request(app).post('/api/v1/admin/login')
    .send({ username: 'admin', password: 'password' }).expect(500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(response.body).includes('private'));
});
