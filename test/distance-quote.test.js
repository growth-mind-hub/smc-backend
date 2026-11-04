import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { googleDistanceProvider } from '../src/modules/add-ons/google-routes.js';
import { applyDistancePricing } from '../src/modules/add-ons/quote.js';

const rules = [
  [0, 28, true, false, 0, false], [28, 30, true, false, 5, false],
  [30, 32, true, false, 10, false], [32, 35, true, true, 15, false], [35, null, false, false, 0, true],
].map(([min, max, minInclusive, maxInclusive, surcharge, support], index) => ({ id: index + 1,
  min_distance_km: min, max_distance_km: max, min_inclusive: minInclusive,
  max_inclusive: maxInclusive, surcharge, is_contact_support: support, currency: 'SGD' }));
const input = { vehicle_id: 3, service_id: 1, pickup: { address: 'Changi Airport Terminal 1' },
  drop: { address: 'Marina Bay Sands' }, add_ons: [{ add_on_id: 2, quantity: 1 }, { add_on_id: 3, quantity: 1 }] };
const catalog = { vehicle_name: 'Alphard', service_name: 'Arrival', catalog_id: 12, price: '80.00',
  currency: 'SGD', unit: 'trip', is_from: false, distance_rules: rules,
  add_ons: [2, 3].map(id => ({ id, name: id === 2 ? 'Meet & Greet' : 'Baby Seat', pricing_type: 'FIXED', price: 20, currency: 'SGD' })) };
const makeApp = (distanceProvider = async () => 29400, overrides = {}) => createApp({ logger: { info() {}, error() {} },
  adminApiKey: 'secret', distanceProvider, vehicleStore: {
    async getQuoteCatalog() { return catalog; }, async listDistanceRules() { return rules; },
    async createDistanceRule(body) { return { id: 6, ...body }; },
    async updateDistanceRule(id, body) { return id === 2 ? { ...rules[1], ...body } : null; }, ...overrides,
  } });

test('distance brackets cover exact meter boundaries including exactly 35 km', async () => {
  for (const [meters, surcharge] of [[0, 0], [27999, 0], [28000, 5], [29400, 5], [29999, 5],
    [30000, 10], [31999, 10], [32000, 15], [33000, 15], [34999, 15], [35000, 15]]) {
    const { body } = await request(makeApp(async () => meters)).post('/api/booking/quote').send(input).expect(200);
    assert.equal(body.quote_status, 'AVAILABLE');
    assert.equal(body.quote.distance_amount, surcharge);
    assert.equal(body.quote.total_amount, 120 + surcharge);
    assert.equal(body.quote.route.distance_km, meters / 1000);
    assert.equal(body.quote.vehicle_amount, 80);
  }
});

test('routes above 35 km return contact support without amounts', async () => {
  for (const meters of [35001, 38700]) {
    const { body } = await request(makeApp(async () => meters)).post('/api/v1/booking/quote').send(input).expect(200);
    assert.equal(body.quote_status, 'CONTACT_SUPPORT');
    assert.equal(body.distance.value, meters / 1000);
    assert.equal(body.whatsapp.enabled, true);
    assert.equal(Object.hasOwn(body, 'quote'), false);
    assert.equal(Object.hasOwn(body, 'total_amount'), false);
  }
});

test('pickup/drop validation rejects missing addresses and client-supplied distances', async () => {
  const app = makeApp(async () => assert.fail('Invalid input must not call Google'), {
    async getQuoteCatalog() { assert.fail('Invalid input must not query catalog'); },
  });
  for (const body of [{ ...input, pickup: undefined }, { ...input, drop: { address: ' ' } },
    { ...input, pickup: null }, { ...input, pickup: { address: 'Airport', distance_km: 1 } },
    { ...input, distance_km: 1 }, { ...input, distance_amount: 0 }, { ...input, pickup: { address: 'x'.repeat(501) } }]) {
    await request(app).post('/api/booking/quote').send(body).expect(400);
  }
});

test('Google provider uses address-based driving routes and validates its response', async () => {
  const provider = googleDistanceProvider({ apiKey: 'test-key', client: { async distancematrix(options) {
    assert.deepEqual(options.params.origins, [input.pickup.address]);
    assert.deepEqual(options.params.destinations, [input.drop.address]);
    assert.equal(options.params.key, 'test-key');
    assert.equal(options.params.mode, 'driving');
    assert.equal(options.params.units, 'metric');
    assert.equal(options.params.region, 'sg');
    assert.equal(options.timeout, 5000);
    return { data: { status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: 29400 } }] }] } };
  } } });
  assert.equal(await provider(input.pickup, input.drop), 29400);
  await assert.rejects(googleDistanceProvider({ apiKey: '' })(input.pickup, input.drop), { code: 'DISTANCE_UNAVAILABLE' });
  for (const data of [{ status: 'REQUEST_DENIED' }, { status: 'OVER_QUERY_LIMIT' }, { status: 'OK', rows: [] },
    { status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: -1 } }] }] },
    { status: 'OK', rows: [{ elements: [{ status: 'OK', distance: { value: '29400' } }] }] }]) {
    const failing = googleDistanceProvider({ apiKey: 'key', client: { async distancematrix() { return { data }; } } });
    await assert.rejects(failing(input.pickup, input.drop), { code: 'DISTANCE_UNAVAILABLE' });
  }
  await assert.rejects(googleDistanceProvider({ apiKey: 'key', client: { async distancematrix() { throw new Error('Timeout with secret URL'); } } })(input.pickup, input.drop),
    err => err.code === 'DISTANCE_UNAVAILABLE' && !err.message.includes('secret'));
  for (const status of ['ZERO_RESULTS', 'NOT_FOUND']) {
    const provider = googleDistanceProvider({ apiKey: 'key', client: { async distancematrix() {
      return { data: { status: 'OK', rows: [{ elements: [{ status }] }] } };
    } } });
    await assert.rejects(provider(input.pickup, input.drop), { code: 'ROUTE_NOT_FOUND' });
  }
  await assert.rejects(googleDistanceProvider({ apiKey: 'key', client: { async distancematrix() {
    throw Object.assign(new Error('Denied'), { response: { data: { status: 'REQUEST_DENIED' } } });
  } } })(input.pickup, input.drop), /Distance Matrix API access/);
});

test('provider errors and missing pricing never fall back to a base-fare quote', async () => {
  for (const [code, status] of [['DISTANCE_UNAVAILABLE', 503], ['ROUTE_NOT_FOUND', 422]]) {
    const app = makeApp(async () => { throw Object.assign(new Error('Route unavailable'), { code }); });
    const { body } = await request(app).post('/api/booking/quote').send(input).expect(status);
    assert.equal(Object.hasOwn(body, 'quote'), false);
  }
  await request(makeApp(async () => 29400, { async getQuoteCatalog() { return { ...catalog, distance_rules: [] }; } }))
    .post('/api/booking/quote').send(input).expect(503);
  await request(makeApp(async () => 29400, { async getQuoteCatalog() { return { ...catalog, distance_rules: rules.map(rule => ({ ...rule, currency: 'USD' })) }; } }))
    .post('/api/booking/quote').send(input).expect(400);
  assert.throws(() => applyDistancePricing(input, { currency: 'SGD' }, [rules[0], rules[0]], 100), { code: 'DISTANCE_PRICING_UNAVAILABLE' });
});

test('admins can manage database distance brackets with validation and conflict errors', async () => {
  const app = makeApp();
  for (const [method, path] of [['get', '/api/distance-pricing-rules'], ['post', '/api/distance-pricing-rules'], ['patch', '/api/distance-pricing-rules/2']]) {
    await request(app)[method](path).expect(401);
  }
  const write = (method, path, body) => request(app)[method](path).set('Authorization', 'Bearer secret').send(body);
  assert.equal((await write('get', '/api/distance-pricing-rules').expect(200)).body.data.length, 5);
  assert.equal((await write('patch', '/api/distance-pricing-rules/2', { surcharge: 7.5 }).expect(200)).body.distance_rule.surcharge, 7.5);
  await write('post', '/api/distance-pricing-rules', { min_distance_km: 40, max_distance_km: null, status: 'INACTIVE' }).expect(201);
  await write('patch', '/api/distance-pricing-rules/99', { surcharge: 5 }).expect(404);
  for (const body of [{}, { surcharge: -1 }, { min_distance_km: null }, { max_inclusive: 'true' }, { max_distance_km: 1, min_distance_km: 2 }, { currency: 'sgd' }, { is_contact_support: true, surcharge: 5 }]) {
    await write('patch', '/api/distance-pricing-rules/2', body).expect(400);
  }
  await request(makeApp(undefined, { async updateDistanceRule() { throw Object.assign(new Error('overlap'), { code: '23P01' }); } }))
    .patch('/api/distance-pricing-rules/2').set('Authorization', 'Bearer secret').send({ surcharge: 5 }).expect(409);
});
