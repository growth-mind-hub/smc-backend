import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { bookingRepository } from '../src/modules/bookings/booking.repository.js';

const input = { customer: { name: 'Customer', email: 'customer@example.com', phone: '+6591234567' },
  vehicle_id: 3, service_id: 1, pickup: { address: 'Airport' }, drop: { address: 'Hotel' }, add_ons: [], driver_name: 'Driver' };
const catalog = { vehicle_name: 'Car', service_name: 'Arrival', catalog_id: 1, price: '80', currency: 'SGD',
  unit: 'trip', is_from: false, add_ons: [], distance_rules: [{ id: 1, min_distance_km: 0, max_distance_km: null,
    min_inclusive: true, max_inclusive: false, surcharge: 0, currency: 'SGD', is_contact_support: false }] };

test('admin creates manual bookings without Stripe, with retry protection and validation', async () => {
  let saved;
  let creates = 0;
  const app = createApp({ adminApiKey: 'secret', logger: { info() {}, error() {} },
    paymentProvider: { assertCheckoutReady() { assert.fail('Manual booking must not call Stripe'); } },
    distanceProvider: async () => 10000, vehicleStore: {
      async getCheckoutByKey() { return saved; },
      async getQuoteCatalog() { return catalog; },
      async createCheckoutBooking(body, quote, key, hash, options) {
        creates++;
        assert.equal(options.manual, true);
        assert.equal(body.driver_name, 'Driver');
        assert.equal(quote.total_amount, 80);
        saved = { booking_number: 'BK20261021001', payment_method: 'MANUAL', request_hash: hash };
        return saved;
      },
    } });
  await request(app).post('/api/bookings').send(input).expect(401);
  await request(app).post('/api/bookings').set('Authorization', 'Bearer secret').type('text').send('test').expect(415);
  for (const body of [{}, { ...input, amount: 1 }, { ...input, payment_method: 'STRIPE' }, { ...input, driver_name: null }]) {
    await request(app).post('/api/bookings').set('Authorization', 'Bearer secret').send(body).expect(400);
  }
  const create = await request(app).post('/api/v1/bookings').set('Authorization', 'Bearer secret')
    .set('Idempotency-Key', 'manual-test-001').send(input).expect(201);
  assert.equal(create.body.booking.payment_method, 'MANUAL');
  assert.equal(create.headers['cache-control'], 'no-store');
  await request(app).post('/api/bookings').set('Authorization', 'Bearer secret')
    .set('Idempotency-Key', 'manual-test-001').send(input).expect(200);
  await request(app).post('/api/bookings').set('Authorization', 'Bearer secret')
    .set('Idempotency-Key', 'manual-test-001').send({ ...input, driver_name: 'Other' }).expect(409);
  assert.equal(creates, 1);
});

test('manual repository creation saves payment method and confirmed status together', async () => {
  const store = bookingRepository({}, fn => fn({ async query(sql, values) {
    assert.match(sql, /INSERT INTO bookings/);
    assert.deepEqual(values.slice(19), ['MANUAL', 'CONFIRMED', 'Driver', '']);
    return { rows: [{ request_hash: 'hash', payment_method: 'MANUAL' }] };
  } }));
  await store.createCheckoutBooking(input, { catalog_id: 1, route: { distance_km: 10 }, vehicle_amount: 80,
    distance_amount: 0, add_on_amount: 0, total_amount: 80, currency: 'SGD', add_ons: [] },
  'manual-test-001', 'hash', { manual: true });
});
