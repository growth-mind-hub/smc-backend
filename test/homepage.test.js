import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const vehicles = [{ id: 1, name: 'MPV', passengerCapacity: 6, luggageCapacity: 4,
  prices: { arrival: { catalogId: 12, amount: 80 } } }, { id: 2, name: 'Minibus' }];
const app = createApp({ logger: { info() {}, error() {} }, vehicleStore: {
  async list() { return vehicles; },

} });
test('homepage flow lists vehicles and returns recommended card plus alternatives', async () => {
  assert.deepEqual((await request(app).get('/api/vehicles').expect(200)).body.data.map(({ recommendation: _recommendation, ...vehicle }) => vehicle), vehicles);
  for (const prefix of ['/api', '/api/v1']) {
    const { body } = await request(app).get(`${prefix}/vehicles/recommend?persons=4&luggage=3`).expect(200);
    assert.equal(body.data[0].recommendation, true);
    assert.equal(body.data[1].recommendation, false);
    assert.equal(body.data[0].prices.arrival.catalogId, 12);
    assert.equal(Object.hasOwn(body, 'recommended'), false);
    assert.equal(Object.hasOwn(body, 'alternatives'), false);
    assert.equal(Object.hasOwn(body, 'vehicles'), false);
  }
});
test('query rejects invalid, repeated and unknown inputs', async () => {
  for (const query of ['', 'persons=0&luggage=3', 'persons=4&luggage=-1', 'persons=4.5&luggage=3',
    'persons=4&persons=5&luggage=3', 'persons=4&luggage=3&price=1', 'persons=101&luggage=0']) {
    await request(app).get(`/api/vehicles/recommend?${query}`).expect(400);
  }
});
test('no matches returns a successful empty recommendation', async () => {
  const empty = createApp({ logger: { info() {}, error() {} }, vehicleStore: { async list() { return []; } } });
  const { body } = await request(empty).get('/api/vehicles/recommend?persons=4&luggage=3').expect(200);
  assert.deepEqual(body.data, []);
});
