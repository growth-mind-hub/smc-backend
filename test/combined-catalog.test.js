import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const prices = { arrival: { catalogId: 1, amount: 80 } };
const vehicles = [
  { id: 1, name: 'Sedan', passengerCapacity: 3, luggageCapacity: 2, prices },
  { id: 2, name: 'Large boot', passengerCapacity: 5, luggageCapacity: 10, prices },
  { id: 3, name: 'MPV', passengerCapacity: 6, luggageCapacity: 6, prices },
  { id: 4, name: 'Van', passengerCapacity: 7, luggageCapacity: 7, prices },
  { id: 5, name: 'Unknown', passengerCapacity: 6, luggageCapacity: null, prices },
  { id: 6, name: 'Unpriced', passengerCapacity: 5, luggageCapacity: 4, prices: {} },
];
const app = createApp({ logger: { info() {}, error() {} }, vehicleStore: { async list() { return vehicles; } } });

test('plain list includes neutral recommendation fields in data only', async () => {
  const { body } = await request(app).get('/api/vehicles').expect(200);
  assert.equal(body.success, true);
  assert.equal(body.requirements, null);
  assert.equal(Object.hasOwn(body, 'recommendation'), false);
  assert.equal(Object.hasOwn(body, 'vehicles'), false);
  assert.equal(body.data[0].recommendation, false);
});
test('combined list ranks total unused capacity while retaining every card and price', async () => {
  const { body } = await request(app).get('/api/vehicles?persons=5&luggage=4').expect(200);
  assert.deepEqual(body.requirements, { persons: 5, luggage: 4 });
  assert.equal(Object.hasOwn(body, 'recommendation'), false);
  assert.equal(body.data.length, vehicles.length);
  assert.equal(body.data[0].recommendation, false);
  assert.equal(body.data[2].recommendation, true);
  assert.equal(body.data[3].recommendation, false);
  assert.equal(body.data[3].recommendation, false);
  assert.equal(body.data[4].recommendation, false);
  assert.equal(body.data[5].recommendation, false);
  assert.deepEqual(body.data[2].prices, prices);
});
test('unmatched requirements retain all cards and no recommended vehicle', async () => {
  const { body } = await request(app).get('/api/v1/vehicles?persons=100&luggage=100').expect(200);
  assert.equal(Object.hasOwn(body, 'recommendation'), false);
  assert.equal(body.data.length, vehicles.length);
  assert.ok(body.data.every(v => !v.recommendation));
});
test('combined list rejects incomplete, invalid and repeated query parameters', async () => {
  for (const query of ['persons=5', 'luggage=4', 'persons=0&luggage=4', 'persons=5&luggage=4&luggage=3', 'other=1']) {
    await request(app).get(`/api/vehicles?${query}`).expect(400);
  }
});
