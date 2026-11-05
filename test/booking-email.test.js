import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { bookingMailer, bookingEmailContent } from '../src/modules/bookings/booking-email.js';

const booking = { id: 'a181390c-b26b-4718-a634-3edfdd3d3cbe', booking_number: 'BK20261021001',
  customer_name: '<script>Customer</script>', customer_email: 'customer@example.com', customer_phone: '+6591234567',
  currency: 'SGD', total_amount_minor: '11000', card_surcharge_minor: '1000', vehicle_amount_minor: '10000',
  distance_amount_minor: '0', add_on_amount_minor: '0', pickup_address: 'Airport', drop_address: 'Hotel',
  status: 'PAID', booking_status: 'NEW', payment_method: 'STRIPE', quote_snapshot: { vehicle: { name: 'Car' }, service: { name: 'Arrival' } } };

function fixture({ record = booking, fail = false } = {}) {
  let notification, sends = 0;
  const app = createApp({ adminApiKey: 'secret', logger: { info() {}, error() {} },
    mailer: { assertReady() {}, async sendConfirmation() { sends++; if (fail) { throw new Error('timeout'); } return 'email-test'; } },
    vehicleStore: {
      async getBooking() { return record; },
      async claimEmailConfirmation() { if (notification) { return false; } notification = { status: 'PENDING' }; return true; },
      async getEmailConfirmation() { return notification; },
      async finishEmailConfirmation(_id, status, messageId) { notification = { status, message_id: messageId }; },
    } });
  const send = (prefix = '/api/v1') => request(app).post(`${prefix}/bookings/${booking.booking_number}/email-confirmation`)
    .set('Authorization', 'Bearer secret').send({});
  return { app, send, sends: () => sends };
}

test('email API requires authentication and rejects arbitrary recipients and ineligible bookings', async () => {
  const f = fixture();
  const path = `/api/v1/bookings/${booking.booking_number}/email-confirmation`;
  await request(f.app).post(path).send({}).expect(401);
  await request(f.app).post(path).set('Authorization', 'Bearer secret').send({ to: 'other@example.com' }).expect(400);
  await fixture({ record: null }).send().expect(404);
  await fixture({ record: { ...booking, status: 'PENDING_PAYMENT' } }).send().expect(409);
  await fixture({ record: { ...booking, booking_status: 'CANCELLED' } }).send().expect(409);
  await fixture({ record: { ...booking, customer_email: 'invalid' } }).send().expect(400);
  assert.equal(f.sends(), 0);
});

test('repeat and concurrent email triggers are deduplicated', async () => {
  const f = fixture();
  const results = await Promise.all([f.send('/api'), f.send()]);
  assert.ok(results.some(r => r.status === 202));
  assert.ok(results.every(r => [200, 202, 409].includes(r.status)));
  assert.equal((await f.send().expect(200)).body.duplicate, true);
  assert.equal(f.sends(), 1);
});

test('uncertain SMTP outcomes are not automatically retried', async () => {
  const f = fixture({ fail: true });
  await f.send().expect(502);
  await f.send().expect(409);
  assert.equal(f.sends(), 1);
});

test('email body escapes stored HTML and includes payment status and surcharge', () => {
  const content = bookingEmailContent(booking);
  assert.ok(!content.html.includes('<script>'));
  assert.ok(content.html.includes('&lt;script&gt;'));
  assert.ok(content.text.includes('Card surcharge: SGD 10.00'));
  assert.ok(content.text.includes('Total booking amount: SGD 110.00'));
  assert.ok(content.text.includes('Payment status: PAID'));
});

test('Hostinger transport uses TLS settings and stored recipient', async () => {
  for (const port of [465, 587]) {
    const mailer = bookingMailer({ port, password: 'test-only', createTransport(options) {
      assert.equal(options.host, 'smtp.hostinger.com');
      assert.equal(options.secure, port === 465);
      assert.equal(options.requireTLS, port === 587);
      return { async sendMail(message) {
        assert.equal(message.from.address, 'booking@singaporemaxicabs.com.sg');
        assert.equal(message.to.address, booking.customer_email);
        return { messageId: 'email-test', accepted: [booking.customer_email] };
      } };
    } });
    assert.equal(await mailer.sendConfirmation(booking), 'email-test');
  }
  assert.throws(() => bookingMailer({ password: '' }).assertReady(), { code: 'EMAIL_NOT_CONFIGURED' });
});
