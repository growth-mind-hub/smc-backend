import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { minimumPrice } from '../src/modules/vehicles/minimum-price.js';

test('minimum prices preserve units, minimum hours, cents, and package prices', () => {
  const vehicle = { prices: {
    arrival: { amount: 75, currency: 'SGD', unit: 'trip' },
    hourly: { amount: 60.25, currency: 'SGD', unit: 'hour', minimumHours: 3, threeHourAmount: 180, eightHourAmount: 480 },
  } };
  const result = minimumPrice(vehicle);
  assert.equal(result.amount, 60.25);
  assert.equal(result.amountMinor, 6025);
  assert.equal(result.unit, 'hour');
  assert.equal(result.minimumHours, 3);
  vehicle.prices.hourly.threeHourAmount = 50;
  assert.equal(minimumPrice(vehicle).unit, 'package');
  assert.equal(minimumPrice(vehicle).hours, 3);
  vehicle.prices.arrival.amount = 0;
  assert.equal(minimumPrice(vehicle).amount, 0);
  vehicle.prices.arrival.currency = 'USD';
  assert.equal(minimumPrice(vehicle), null);
  assert.equal(minimumPrice({ prices: {} }), null);
});

test('public minimum price list is available on both API prefixes', async () => {
  const app = createApp({ logger: { info() {}, error() {} }, vehicleStore: {
    async list() { return [{ id: 3, name: 'MPV', imageUrl: '/uploads/vehicles/photo.jpg', passengerCapacity: 6, luggageCapacity: 6,
      prices: { departure_transfer: { amount: 65, currency: 'SGD', unit: 'trip', isFrom: true, catalogId: 8 } } }]; },
  } });
  for (const prefix of ['/api', '/api/v1']) {
    const response = await request(app).get(prefix + '/vehicles/minimum-prices').expect(200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data[0].id, 3);
    assert.equal(response.body.data[0].minimumPrice.amount, 65);
    assert.equal(response.body.data[0].minimumPrice.isFrom, true);
    assert.equal(response.body.data[0].minimumPrice.catalogId, 8);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
});
