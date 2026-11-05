import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { whatsappProvider } from '../src/modules/bookings/whatsapp.js';

const booking = { id: 'a181390c-b26b-4718-a634-3edfdd3d3cbe', booking_number: 'BK20261021001',
  customer_name: 'Customer', customer_phone: '+6591234567', currency: 'SGD', total_amount_minor: '8000',
  pickup_address: 'Airport', drop_address: 'Hotel', status: 'PAID', booking_status: 'NEW', payment_method: 'STRIPE' };

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

test('Meta receives stored recipient and the five approved template parameters', async () => {
  const provider = whatsappProvider({ token: 'test-token', phoneNumberId: '12345', version: 'v23.0',
    template: 'booking_confirmation', language: 'en', async fetchImpl(url, options) {
      assert.equal(url, 'https://graph.facebook.com/v23.0/12345/messages');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      const payload = JSON.parse(options.body);
      assert.equal(payload.to, '6591234567');
      assert.equal(payload.template.name, 'booking_confirmation');
      assert.deepEqual(payload.template.components[0].parameters.map(p => p.text),
        ['Customer', 'BK20261021001', 'SGD 80.00', 'Airport', 'Hotel']);
      return { ok: true, async json() { return { messages: [{ id: 'wamid.test' }] }; } };
    } });
  assert.equal(await provider.sendConfirmation(booking), 'wamid.test');
  assert.throws(() => whatsappProvider({ token: '' }).assertReady(), { code: 'WHATSAPP_NOT_CONFIGURED' });
  const rejected = whatsappProvider({ token: 'test-token', phoneNumberId: '12345', version: 'v23.0',
    template: 'booking_confirmation', language: 'en', async fetchImpl() { return { ok: false }; } });
  await assert.rejects(() => rejected.sendConfirmation(booking));
});
