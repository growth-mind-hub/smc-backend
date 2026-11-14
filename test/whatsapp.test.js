import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { whatsappProvider, confirmationParameters } from '../src/modules/bookings/whatsapp.js';

const booking = { id: 'a181390c-b26b-4718-a634-3edfdd3d3cbe', booking_number: 'BK20261021001',
  customer_name: 'Customer', customer_phone: '+6591234567', currency: 'SGD', total_amount_minor: '8000',
  pickup_address: 'Airport', drop_address: 'Hotel', status: 'PAID', booking_status: 'NEW', payment_method: 'STRIPE',
  vehicle_amount_minor: '8000', quote_snapshot: { vehicle: { name: 'Toyota Alphard / Vellfire' }, add_ons: [] } };

function fixture({ record = booking, fail = false } = {}) {
  let notification;
  let sends = 0;
  const app = createApp({ adminApiKey: 'secret', logger: { info() {}, error() {} },
    whatsapp: { assertReady() {}, async sendConfirmation() { sends++; if (fail) { throw new Error('timeout'); } return 'wamid.test'; } },
    vehicleStore: {
      async getBooking() { return record; },
      async claimWhatsappConfirmation() { if (notification) { return false; } notification = { status: 'PENDING' }; return true; },
      async getWhatsappConfirmation() { return notification; },
      async finishWhatsappConfirmation(_id, status, messageId) { notification = { status, message_id: messageId }; },
    },
  });
  const send = (prefix = '/api/v1') => request(app).post(`${prefix}/bookings/${booking.booking_number}/whatsapp-confirmation`)
    .set('Authorization', 'Bearer secret').send({ whatsapp_opt_in: true });
  return { app, send, sends: () => sends };
}

test('confirmation requires admin authentication, consent and an eligible booking', async () => {
  const f = fixture();
  const url = `/api/v1/bookings/${booking.booking_number}/whatsapp-confirmation`;
  await request(f.app).post(url).send({ whatsapp_opt_in: true }).expect(401);
  await request(f.app).post(url).set('Authorization', 'Bearer secret').send({}).expect(400);
  await request(f.app).post(url).set('Authorization', 'Bearer secret').send({ whatsapp_opt_in: true, to: '+6511111111' }).expect(400);
  await fixture({ record: null }).send().expect(404);
  await fixture({ record: { ...booking, status: 'PENDING_PAYMENT' } }).send().expect(409);
  await fixture({ record: { ...booking, booking_status: 'CANCELLED' } }).send().expect(409);
  await fixture({ record: { ...booking, status: 'PENDING_PAYMENT', payment_method: 'MANUAL', booking_status: 'CONFIRMED' } }).send().expect(202);
  assert.equal(f.sends(), 0);
});

test('repeat and concurrent triggers send only once across both prefixes', async () => {
  const f = fixture();
  const results = await Promise.all([f.send('/api'), f.send('/api/v1')]);
  assert.ok(results.some(r => r.status === 202));
  assert.ok(results.every(r => [200, 202, 409].includes(r.status)));
  const retry = await f.send().expect(200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(f.sends(), 1);
});

test('uncertain sends are persisted and cannot be blindly retried', async () => {
  const f = fixture({ fail: true });
  await f.send().expect(502);
  await f.send().expect(409);
  assert.equal(f.sends(), 1);
});

test('Twilio receives the stored recipient, approved ContentSid and exact template variable order', async () => {
  const accountSid = 'AC' + '1'.repeat(32);
  const contentSid = 'HX' + '2'.repeat(32);
  const sid = 'SM' + '3'.repeat(32);
  const config = { accountSid, contentSid, authToken: 'test-token', from: 'whatsapp:+6589536201' };
  const provider = whatsappProvider({ ...config, async fetchImpl(url, options) {
    assert.equal(url, `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`);
    assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from(`${accountSid}:test-token`).toString('base64'));
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    const fields = new URLSearchParams(options.body);
    assert.equal(fields.get('To'), 'whatsapp:+6591234567');
    assert.equal(fields.get('From'), config.from);
    assert.equal(fields.get('ContentSid'), contentSid);
    assert.deepEqual(JSON.parse(fields.get('ContentVariables')), {
      '1': 'Customer', '2': '+6591234567', '3': 'BK20261021001', '4': 'Toyota Alphard / Vellfire', '5': 'Airport',
      '6': 'Hotel', '7': 'Vehicle fare: SGD 80.00', '8': '80.00', '9': 'Payment received. Thank you.',
    });
    return { ok: true, async json() { return { sid, status: 'queued' }; } };
  } });
  assert.equal(await provider.sendConfirmation(booking), sid);
  const mediaSid = 'MM' + '4'.repeat(32);
  assert.equal(await whatsappProvider({ ...config, async fetchImpl() {
    return { ok: true, async json() { return { sid: mediaSid, status: 'queued' }; } };
  } }).sendConfirmation(booking), mediaSid);
  assert.throws(() => whatsappProvider({ ...config, authToken: '' }).assertReady(), { code: 'WHATSAPP_NOT_CONFIGURED' });
  await assert.rejects(() => whatsappProvider({ ...config, async fetchImpl() { return { ok: false }; } }).sendConfirmation(booking));
  await assert.rejects(() => whatsappProvider({ ...config, async fetchImpl() {
    return { ok: true, async json() { return { sid, status: 'failed' }; } };
  } }).sendConfirmation(booking));
});

test('confirmation breakdown and payment status match the approved booking template', () => {
  const values = confirmationParameters({ ...booking, status: 'PENDING_PAYMENT', total_amount_minor: 14850,
    distance_amount_minor: 3500, add_on_amount_minor: 2000, card_surcharge_minor: 1350,
    quote_snapshot: { ...booking.quote_snapshot, add_ons: [{ name: 'Arrival Driveway Pickup', quantity: 1, amount: 20 }] } });
  assert.equal(values.length, 9);
  assert.equal(values[2], booking.booking_number);
  assert.equal(values[5], 'Hotel');
  assert.equal(values[6], 'Vehicle fare: SGD 80.00; Distance charge: SGD 35.00; Arrival Driveway Pickup x 1: SGD 20.00; Card surcharge: SGD 13.50');
  assert.equal(values[7], '148.50');
  assert.match(values[8], /Payment pending/);
  assert.ok(values.every(value => !/[\r\n\t]/.test(value)));
});
