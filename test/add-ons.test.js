import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { addOnRepository } from '../src/modules/add-ons/add-on.repository.js';

const addOns = [
  { id: 1, code: 'NIGHT_TRAVEL', name: 'Night travel', pricing_type: 'FIXED', price: 10, currency: 'SGD' },
  { id: 2, code: 'MEET_GREET', name: 'Meet & Greet', pricing_type: 'FIXED', price: 20, currency: 'SGD' },
  { id: 3, code: 'BABY_SEAT', name: 'Baby seat', pricing_type: 'FIXED', price: 20, currency: 'SGD' },
  { id: 4, code: 'STOP_WITHIN_2KM', name: 'Stop within 2 km', pricing_type: 'PER_STOP', price: 10, currency: 'SGD' },
  { id: 5, code: 'STOP_OVER_2KM', name: 'Stop over 2 km', pricing_type: 'PER_STOP', price: 20, currency: 'SGD' },
];
const catalog = { vehicle_name: 'Alphard', service_name: 'Arrival', catalog_id: 12,
  price: '80.00', currency: 'SGD', unit: 'trip', is_from: false, add_ons: addOns,
  distance_rules: [{ id: 1, min_distance_km: 0, max_distance_km: 28, min_inclusive: true, max_inclusive: false, surcharge: 0, currency: 'SGD', is_contact_support: false }] };
const input = { vehicle_id: 3, service_id: 1, pickup: { address: 'Changi Airport Terminal 1' }, drop: { address: 'Marina Bay Sands' },
  add_ons: addOns.map(item => ({ add_on_id: item.id, quantity: item.id === 4 ? 2 : 1 })) };
const makeApp = (overrides = {}) => createApp({ logger: { info() {}, error() {} }, adminApiKey: 'secret', distanceProvider: async () => 20000, vehicleStore: {
  async listAddOns() { return addOns; },
  async createAddOn(body) { return { id: 6, ...body }; },
  async updateAddOn(id, body) { return id === 1 ? { ...addOns[0], ...body } : null; },
  async deleteAddOn(id) { return id === 1; },
  async getQuoteCatalog() { return catalog; },
  ...overrides,
} });

test('add-on deletion requires authentication, handles missing records and protects booking history', async () => {
  const app = makeApp();
  for (const prefix of ['/api', '/api/v1']) {
    await request(app).delete(`${prefix}/add-ons/1`).expect(401);
    await request(app).delete(`${prefix}/add-ons/1`).set('Authorization', 'Bearer invalid').expect(401);
    const result = await request(app).delete(`${prefix}/add-ons/1`).set('Authorization', 'Bearer secret').expect(204);
    assert.equal(result.text, '');
    assert.equal(result.headers['cache-control'], 'no-store');
    for (const id of ['99', 'bad', '0', '2147483648']) {
      await request(app).delete(`${prefix}/add-ons/${id}`).set('Authorization', 'Bearer secret').expect(404);
    }
  }
  const inUse = makeApp({ async deleteAddOn() { throw Object.assign(new Error('referenced'), { code: '23503' }); } });
  const result = await request(inUse).delete('/api/add-ons/1').set('Authorization', 'Bearer secret').expect(409);
  assert.equal(result.body.error.code, 'ADD_ON_IN_USE');
});

test('add-on repository reports whether a row was deleted', async () => {
  const store = addOnRepository({ async query(sql, values) {
    assert.equal(sql, 'DELETE FROM add_ons WHERE id = $1 RETURNING id');
    return { rows: values[0] === 1 ? [{ id: 1 }] : [] };
  } });
  assert.equal(await store.deleteAddOn(1), true);
  assert.equal(await store.deleteAddOn(99), false);
});

test('both API prefixes list add-ons and calculate the supplied $170 example', async () => {
  const app = makeApp();
  for (const prefix of ['/api', '/api/v1']) {
    assert.deepEqual((await request(app).get(`${prefix}/add-ons`).expect(200)).body.data, addOns);
    const { body, headers } = await request(app).post(`${prefix}/booking/quote`).send(input).expect(200);
    assert.equal(headers['cache-control'], 'no-store');
    assert.equal(body.quote.vehicle_amount, 80);
    assert.equal(body.quote.add_on_amount, 90);
    assert.equal(body.quote.total_amount, 170);
    assert.equal(body.quote.add_ons[3].amount, 20);
    assert.equal(body.quote.currency, 'SGD');
  }
});

test('quotes reject tampering, duplicate selections and invalid quantities before querying', async () => {
  const app = makeApp({ async getQuoteCatalog() { assert.fail('Invalid input must not query prices'); } });
  for (const body of [[], {}, { ...input, amount: 1 }, { ...input, vehicle_id: '3' },
    { ...input, add_ons: [{ add_on_id: 1, quantity: 1, amount: 1 }] },
    { ...input, add_ons: [{ add_on_id: 1, quantity: 1 }, { add_on_id: 1, quantity: 1 }] },
    { ...input, add_ons: [{ add_on_id: 4, quantity: 0 }] },
    { ...input, add_ons: [{ add_on_id: 4, quantity: 1.5 }] },
    { ...input, add_ons: [{ add_on_id: 4, quantity: 101 }] }]) {
    await request(app).post('/api/booking/quote').send(body).expect(400);
  }
  await request(app).post('/api/booking/quote').type('text').send('hello').expect(415);
});

test('missing prices and add-ons, mixed currency, fixed quantities and starting prices are rejected', async () => {
  await request(makeApp({ async getQuoteCatalog() { return null; } })).post('/api/booking/quote').send(input).expect(404);
  await request(makeApp({ async getQuoteCatalog() { return { ...catalog, add_ons: [] }; } })).post('/api/booking/quote').send(input).expect(404);
  await request(makeApp({ async getQuoteCatalog() { return { ...catalog, currency: 'USD' }; } })).post('/api/booking/quote').send(input).expect(400);
  await request(makeApp()).post('/api/booking/quote').send({ ...input, add_ons: [{ add_on_id: 1, quantity: 2 }] }).expect(400);
  await request(makeApp({ async getQuoteCatalog() { return { ...catalog, is_from: true }; } })).post('/api/booking/quote').send(input).expect(409);
});

test('hourly quotes multiply the rate and enforce minimum hours; trip rates reject hours', async () => {
  const app = makeApp({ async getQuoteCatalog() { return { ...catalog, unit: 'hour', minimum_hours: 3, price: '65.10' }; } });
  await request(app).post('/api/booking/quote').send(input).expect(400);
  await request(app).post('/api/booking/quote').send({ ...input, hours: 2 }).expect(400);
  const { body } = await request(app).post('/api/booking/quote').send({ ...input, hours: 3, add_ons: [] }).expect(200);
  assert.equal(body.quote.vehicle_amount, 195.3);
  assert.equal(body.quote.total_amount, 195.3);
  await request(makeApp()).post('/api/booking/quote').send({ ...input, hours: 3 }).expect(400);
});

test('admin writes require authorization and validate prices and editable fields', async () => {
  const app = makeApp();
  await request(app).post('/api/add-ons').send({}).expect(401);
  await request(app).patch('/api/add-ons/1').send({ price: 15 }).expect(401);
  const write = (method, path, body) => request(app)[method](path).set('Authorization', 'Bearer secret').send(body);
  await write('post', '/api/add-ons', { code: 'TOUR_STOP', name: 'Tour stop', pricing_type: 'PER_STOP', price: 15 }).expect(201);
  assert.equal((await write('patch', '/api/add-ons/1', { price: 15 }).expect(200)).body.add_on.price, 15);
  await write('patch', '/api/add-ons/99', { price: 15 }).expect(404);
  for (const body of [{}, { price: -1 }, { price: 1.001 }, { price: null }, { currency: 'sgd' }, { status: 'active' }, { code: 'NEW' }]) {
    await write('patch', '/api/add-ons/1', body).expect(400);
  }
  await request(makeApp({ async createAddOn() { throw Object.assign(new Error('duplicate'), { code: '23505' }); } }))
    .post('/api/add-ons').set('Authorization', 'Bearer secret')
    .send({ code: 'NIGHT_TRAVEL', name: 'Night', pricing_type: 'FIXED', price: 10 }).expect(409);
});
