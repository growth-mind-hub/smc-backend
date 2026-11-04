import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { bookingRepository } from '../src/modules/bookings/booking.repository.js';

function fixture() {
  const booking = { booking_number: 'BK20261003001', status: 'PAID', booking_status: 'NEW', driver_name: '', driver_phone: '' };
  const app = createApp({ adminApiKey: '', logger: { info() {}, error() {} }, vehicleStore: {
    async authenticateAdmin() { return { id: 1 }; },
    async listBookings() { return [booking]; },
    async getBooking(id) { return id === booking.booking_number ? booking : null; },
    async deleteBooking(id) { return id === booking.booking_number; },
    async updateBooking(id, body) { return id === booking.booking_number ? Object.assign(booking, body) : null; },
  } });
  return { app, booking };
}

test('booking reads and updates require login and work across aliases', async () => {
  const { app, booking } = fixture();
  const login = await request(app).post('/api/v1/admin/login').send({ username: 'admin', password: 'password' }).expect(200);
  const token = `Bearer ${login.body.access_token}`;
  for (const prefix of ['/api', '/api/v1']) {
    for (const path of ['/bookings', '/bookings/BK20261003001']) {
      await request(app).get(prefix + path).expect(401);
      await request(app).get(prefix + path).set('Authorization', 'Bearer invalid').expect(401);
      await request(app).get(prefix + path).set('Authorization', token).expect(200);
    }
    await request(app).patch(`${prefix}/bookings/BK20261003001`).send({ booking_status: 'CANCELLED' }).expect(401);
    const result = await request(app).patch(`${prefix}/bookings/BK20261003001`).set('Authorization', token)
      .send({ booking_status: 'ASSIGNED', driver_name: 'Driver', driver_phone: '9123 4567' }).expect(200);
    assert.equal(result.body.booking.status, 'PAID');
    assert.equal(result.body.booking.driver_name, 'Driver');
    assert.equal(result.body.booking.driver_phone, '9123 4567');
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  await request(app).patch('/api/bookings/BK20261003001').set('Authorization', token).send({ driver_name: '', driver_phone: '' }).expect(200);
  assert.equal(booking.driver_name, '');
  assert.equal(booking.driver_phone, '');
});

test('booking admin rejects invalid changes and handles missing bookings', async () => {
  const { app } = fixture();
  const login = await request(app).post('/api/admin/login').send({ username: 'admin', password: 'password' });
  const token = `Bearer ${login.body.access_token}`;
  for (const body of [{}, { status: 'PAID' }, { booking_status: 'PAID' }, { assigned_drivers: [] },
    { driver_name: null }, { driver_phone: 123 }, { driver_name: [] }, { driver_phone: {} }]) {
    await request(app).patch('/api/bookings/BK20261003001').set('Authorization', token).send(body).expect(400);
  }
  await request(app).patch('/api/bookings/BK20261003001').set('Authorization', token).type('text').send('test').expect(415);
  for (const path of ['/bookings?limit=101', '/bookings?offset=-1', '/bookings?limit[x]=1', '/bookings/bad']) {
    await request(app).get('/api' + path).set('Authorization', token).expect(400);
  }
  await request(app).get('/api/bookings/BK20261003999').set('Authorization', token).expect(404);
  await request(app).patch('/api/bookings/BK20261003999').set('Authorization', token).send({ booking_status: 'CONFIRMED' }).expect(404);
});

test('booking repository preserves omitted assignments and replaces explicit assignments', async () => {
  const calls = [];
  const store = bookingRepository({ async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; } });
  await store.updateBooking('BK20261003001', { booking_status: 'COMPLETED' });
  assert.deepEqual(calls[0].values, ['BK20261003001', 'COMPLETED', null, null]);
  await store.updateBooking('BK20261003001', { driver_name: '', driver_phone: '' });
  assert.deepEqual(calls[1].values, ['BK20261003001', null, '', '']);
  assert.ok(!calls[0].sql.includes('SET status'));
});

test('booking deletion requires admin authentication and accepts no request body', async () => {
  const { app } = fixture();
  const login = await request(app).post('/api/admin/login').send({ username: 'admin', password: 'password' });
  const token = `Bearer ${login.body.access_token}`;
  for (const prefix of ['/api', '/api/v1']) {
    await request(app).delete(`${prefix}/bookings/BK20261003001`).expect(401);
    await request(app).delete(`${prefix}/bookings/BK20261003001`).set('Authorization', 'Bearer invalid').expect(401);
    const result = await request(app).delete(`${prefix}/bookings/BK20261003001`).set('Authorization', token).expect(204);
    assert.equal(result.text, '');
    assert.equal(result.headers['cache-control'], 'no-store');
    await request(app).delete(`${prefix}/bookings/bad`).set('Authorization', token).expect(400);
    await request(app).delete(`${prefix}/bookings/BK20261003999`).set('Authorization', token).expect(404);
  }
});

test('booking deletion locks the booking and removes dependent rows in the transaction', async () => {
  const calls = [];
  const client = { async query(sql, values) {
    calls.push({ sql, values });
    return { rows: sql.startsWith('SELECT') ? [{ id: 'internal-uuid' }] : [] };
  } };
  const store = bookingRepository({}, fn => fn(client));
  assert.equal(await store.deleteBooking('BK20261003001'), true);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(calls.slice(1).map(call => call.sql), [
    'DELETE FROM booking_add_ons WHERE booking_id = $1',
    'DELETE FROM stripe_webhook_events WHERE booking_id = $1',
    'DELETE FROM bookings WHERE id = $1',
  ]);
  assert.ok(calls.slice(1).every(call => call.values[0] === 'internal-uuid'));
  const missing = bookingRepository({}, fn => fn({ async query() { return { rows: [] }; } }));
  assert.equal(await missing.deleteBooking('BK20261003999'), false);
});
