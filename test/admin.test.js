import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const services = [{ code: 'arrival', name: 'Arrival', unit: 'trip' }, { code: 'hourly', name: 'Hourly', unit: 'hour' }];
const vehicle = { id: 1, name: 'MPV', prices: {} };
const app = createApp({ adminApiKey: 'secret', logger: { info() {}, error() {} }, vehicleStore: {
  async listServices() { return services; },
  async updateVehicle(id, body) { return id === 1 ? { ...vehicle, ...body } : null; },
  async setPrice(id, service, body) { return id === 1 ? { ...vehicle, prices: { [service]: body } } : null; },
  async createService(body) { return body; },
  async updateService(code, body) { return services.find(s => s.code === code) ? { ...services.find(s => s.code === code), ...body } : null; },
} });
const write = (method, path, body) => request(app)[method](path).set('Authorization', 'Bearer secret').send(body);

test('all admin mutations reject unauthenticated requests', async () => {
  for (const [method, path] of [['patch', '/api/v1/vehicles/1'], ['put', '/api/v1/vehicles/1/prices/arrival'],
    ['post', '/api/v1/services'], ['patch', '/api/v1/services/arrival']]) {
    await request(app)[method](path).send({}).expect(401);
  }
});
test('admin updates metadata and per-category prices; missing records return 404', async () => {
  const updated = await write('patch', '/api/v1/vehicles/1', { name: 'New name', passengerCapacity: null }).expect(200);
  assert.equal(updated.body.vehicle.name, 'New name');
  const price = await write('put', '/api/v1/vehicles/1/prices/hourly', { amount: 75.50, minimumHours: 3 }).expect(200);
  assert.equal(price.body.vehicle.prices.hourly.amount, 75.50);
  await write('put', '/api/v1/vehicles/1/prices/unknown', { amount: 10 }).expect(404);
  await write('patch', '/api/v1/vehicles/99', { name: 'Missing' }).expect(404);
  await write('put', '/api/v1/vehicles/99/prices/arrival', { amount: 10 }).expect(404);
});
test('invalid prices and forbidden metadata changes are rejected', async () => {
  for (const body of [{ amount: -1 }, { amount: 1.001 }, { amount: '90' }, { amount: 10, minimumHours: 3 }, { amount: 10, extra: true }]) {
    await write('put', '/api/v1/vehicles/1/prices/arrival', body).expect(400);
  }
  await write('patch', '/api/v1/vehicles/1', {}).expect(400);
  await write('patch', '/api/v1/vehicles/1', { currency: 'USD' }).expect(400);
  await write('patch', '/api/v1/services/hourly', { unit: 'trip' }).expect(400);
});
test('admin creates and renames database services', async () => {
  await write('post', '/api/v1/services', { code: 'tour', name: 'City tour', unit: 'hour' }).expect(201);
  const renamed = await write('patch', '/api/v1/services/arrival', { name: 'Airport pickup' }).expect(200);
  assert.equal(renamed.body.service.name, 'Airport pickup');
  await write('post', '/api/v1/services', { code: 'INVALID', name: 'Tour', unit: 'trip' }).expect(400);
  await write('patch', '/api/v1/services/unknown', { name: 'Missing' }).expect(404);
});
