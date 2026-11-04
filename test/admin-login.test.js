import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { adminLogin } from '../src/middleware/admin-login.js';

const makeApp = (options = {}) => createApp({
  adminApiKey: '',
  logger: { info() {}, error() {} },
  vehicleStore: {
    async authenticateAdmin(username, password) {
      return username === 'admin' && password === 'test-password' ? { id: 1 } : null;
    },
    async listDistanceRules() { return []; },
    async updateVehicle(id, body) { return { id, ...body }; },
  }, ...options,
});

test('login aliases issue tokens accepted by protected reads and writes', async () => {
  const app = makeApp();
  for (const prefix of ['/api', '/api/v1']) {
    const login = await request(app).post(`${prefix}/admin/login`)
      .send({ username: 'admin', password: 'test-password' }).expect(200);
    assert.equal(login.headers['cache-control'], 'no-store');
    assert.equal(login.body.expires_in, 3600);
    assert.equal(login.body.token_type, 'Bearer');
    assert.notEqual(login.body.access_token, 'test-password');
    const header = `Bearer ${login.body.access_token}`;
    await request(app).get(`${prefix}/distance-pricing-rules`).set('Authorization', header).expect(200);
    await request(app).patch(`${prefix}/vehicles/1`).set('Authorization', header).send({ name: 'Updated' }).expect(200);
  }
  await request(app).get('/api/v1/distance-pricing-rules').set('Authorization', 'Bearer invalid').expect(401);
});

test('login rejects bad credentials, invalid bodies and missing configuration', async () => {
  const app = makeApp();
  for (const body of [{ username: 'wrong', password: 'test-password' }, { username: 'admin', password: 'wrong' }]) {
    await request(app).post('/api/v1/admin/login').send(body).expect(401);
  }
  for (const body of [{}, { username: 'admin', password: 1 }, { username: 'admin', password: 'test-password', role: 'admin' }]) {
    await request(app).post('/api/v1/admin/login').send(body).expect(400);
  }
  await request(app).post('/api/v1/admin/login').type('text').send('hello').expect(415);
  await request(makeApp({ vehicleStore: {} })).post('/api/admin/login')
    .send({ username: 'admin', password: 'test-password' }).expect(503);
});

test('sessions expire after one hour', async () => {
  let time = 0;
  const auth = adminLogin({ authenticate: async () => ({ id: 1 }), now: () => time });
  let result;
  await auth.login({ is: () => true, body: { username: 'admin', password: 'password' } }, {
    setHeader() {}, json(body) { result = body; },
  });
  assert.equal(auth.verify(`Bearer ${result.access_token}`), true);
  time = 3600000;
  assert.equal(auth.verify(`Bearer ${result.access_token}`), false);
});

test('login attempts share a rate limit across aliases', async () => {
  const app = makeApp();
  for (let attempt = 0; attempt < 10; attempt++) {
    await request(app).post('/api/admin/login').send({ username: 'admin', password: 'wrong' }).expect(401);
  }
  await request(app).post('/api/v1/admin/login').send({ username: 'admin', password: 'test-password' }).expect(429);
});

test('refresh aliases rotate tokens and reject reuse, invalid tokens and invalid bodies', async () => {
  const app = makeApp();
  for (const prefix of ['/api', '/api/v1']) {
    const login = await request(app).post(`${prefix}/admin/login`)
      .send({ username: 'admin', password: 'test-password' }).expect(200);
    assert.equal(login.body.refresh_expires_in, 604800);
    const refreshed = await request(app).post(`${prefix}/admin/refresh`)
      .send({ refresh_token: login.body.refresh_token }).expect(200);
    assert.equal(refreshed.headers['cache-control'], 'no-store');
    assert.notEqual(refreshed.body.refresh_token, login.body.refresh_token);
    assert.notEqual(refreshed.body.access_token, login.body.access_token);
    await request(app).get(`${prefix}/distance-pricing-rules`)
      .set('Authorization', `Bearer ${refreshed.body.access_token}`).expect(200);
    await request(app).get(`${prefix}/distance-pricing-rules`)
      .set('Authorization', `Bearer ${login.body.access_token}`).expect(401);
    await request(app).post(`${prefix}/admin/refresh`)
      .send({ refresh_token: login.body.refresh_token }).expect(401);
    await request(app).post(`${prefix}/admin/refresh`)
      .send({ refresh_token: login.body.access_token }).expect(401);
  }
  for (const body of [{}, { refresh_token: 123 }, { refresh_token: '' }, { refresh_token: 'x', extra: true }]) {
    await request(app).post('/api/admin/refresh').send(body).expect(400);
  }
  await request(app).post('/api/admin/refresh').send({ refresh_token: 'invalid' }).expect(401);
  await request(app).post('/api/admin/refresh').type('text').send('hello').expect(415);
});

test('refresh survives access expiry but preserves the original seven-day deadline', async () => {
  let time = 0;
  const auth = adminLogin({ authenticate: async () => ({ id: 1 }), now: () => time });
  let result;
  const res = { setHeader() {}, json(body) { result = body; },
    status(code) { this.statusCode = code; return this; } };
  await auth.login({ is: () => true, body: { username: 'admin', password: 'password' } }, res);
  const original = result;
  time = 3600000;
  auth.refresh({ is: () => true, body: { refresh_token: original.refresh_token } }, res);
  assert.equal(result.refresh_expires_in, 604800 - 3600);
  assert.equal(auth.verify(`Bearer ${result.access_token}`), true);
  const rotated = result.refresh_token;
  time = 604800000;
  auth.refresh({ is: () => true, body: { refresh_token: rotated } }, res);
  assert.equal(res.statusCode, 401);
});
