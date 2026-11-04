import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const logger = { info() {}, error() {} };
const body = { name: 'MPV', currency: 'SGD', prices: {
  arrival: { amount: 80 }, departure_transfer: { amount: 70 }, hourly: { amount: 65 },
} };

test('catalog ID resolves the selected vehicle and service', async () => {
  const catalog = { catalogId: 12, vehicleId: 1, service: 'arrival', currency: 'SGD', price: { amount: 95 } };
  const app = createApp({ logger, vehicleStore: {
    async getCatalogEntry(id) { return id === 12 ? catalog : null; },
  } });
  assert.deepEqual((await request(app).get('/api/v1/catalog/12').expect(200)).body.catalog, catalog);
  await request(app).get('/api/v1/catalog/999').expect(404);
  await request(app).get('/api/v1/catalog/invalid').expect(404);
});
test('vehicle routes await asynchronous database results', async () => {
  const vehicle = { ...body, id: 1 };
  const app = createApp({ logger, adminApiKey: 'secret', vehicleStore: {
    async listServices() { return [{code:'arrival',unit:'trip'}, {code:'departure_transfer',unit:'trip'}, {code:'hourly',unit:'hour'}]; },
    async list() { return [vehicle]; },
    async get(id) { return id === 1 ? vehicle : null; },
    async create(input) { return { ...input, id: 1 }; },
  } });
  assert.deepEqual((await request(app).get('/api/v1/vehicles').expect(200)).body.data.map(({ recommendation: _recommendation, ...item }) => item), [vehicle]);
  assert.deepEqual((await request(app).get('/api/v1/vehicles/1').expect(200)).body.vehicle, vehicle);
  await request(app).get('/api/v1/vehicles/2').expect(404);
  const res = await request(app).post('/api/v1/vehicles').set('Authorization', 'Bearer secret').send(body).expect(201);
  assert.deepEqual(res.body.vehicle, vehicle);
});
test('PostgreSQL duplicate errors return 409 and rejected queries return 500', async () => {
  const app = createApp({ logger, adminApiKey: 'secret', vehicleStore: {
    async listServices() { return [{code:'arrival',unit:'trip'}, {code:'departure_transfer',unit:'trip'}, {code:'hourly',unit:'hour'}]; },
    async create() { throw Object.assign(new Error('duplicate'), { code: '23505' }); },
    async list() { throw new Error('connection lost'); },
  } });
  await request(app).post('/api/v1/vehicles').set('Authorization', 'Bearer secret').send(body).expect(409);
  const res = await request(app).get('/api/v1/vehicles').expect(500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
});
