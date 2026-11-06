import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { validateCheckout, normalizeCheckout } from '../src/modules/bookings/checkout.validation.js';
import { bookingEmailContent } from '../src/modules/bookings/booking-email.js';

function fixture({ type = 'checkout.session.completed', paid = true, sendFails = false, configured = true } = {}) {
  let notification, sent = 0;
  const booking = { id: 'a181390c-b26b-4718-a634-3edfdd3d3cbe', booking_number: 'BK20261021001', status: 'PAID',
    booking_status: 'CONFIRMED', customer_name: 'Test Customer', customer_email: 'test@example.com', pax: 2, luggage: 1,
    currency: 'SGD', total_amount_minor: 11000, quote_snapshot: { vehicle: { name: 'Sedan' } } };
  const event = { type, data: { object: { payment_status: paid ? 'paid' : 'unpaid' } } };
  const app = createApp({ logger: { info() {}, error() {} },
    paymentProvider: { verifyWebhook() { return event; } },
    mailer: { assertReady() { if (!configured) { throw new Error('missing SMTP config'); } },
      async sendConfirmation(actual) { assert.equal(actual.id, booking.id); sent++; if (sendFails) { throw new Error('timeout'); } return 'mail-test'; } },
    vehicleStore: {
      async applyStripeEvent() { return { status: 'PAID', booking_id: booking.id }; },
      async getBooking() { return booking; },
      async claimEmailConfirmation() { if (notification) { return false; } notification = { status: 'PENDING' }; return true; },
      async getEmailConfirmation() { return notification; },
      async finishEmailConfirmation(_id, status) { notification = { status }; },
    } });
  return { app, booking, sent: () => sent, status: () => notification?.status };
}
const trigger = app => request(app).post('/api/v1/payments/stripe/webhook').set('Content-Type', 'application/json').send('{}');

test('paid completion and async success automatically email once despite repeated webhooks', async () => {
  for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) {
    const f = fixture({ type });
    await trigger(f.app).expect(200);
    await trigger(f.app).expect(200);
    assert.equal(f.sent(), 1);
    assert.equal(f.status(), 'ACCEPTED');
  }
});

test('unpaid completions and failure/expiration events do not send', async () => {
  for (const options of [{ paid: false }, { type: 'checkout.session.expired' }, { type: 'checkout.session.async_payment_failed' }]) {
    const f = fixture(options);
    await trigger(f.app).expect(200);
    assert.equal(f.sent(), 0);
  }
});

test('SMTP uncertainty preserves paid payment and prevents duplicate send; missing config is retryable', async () => {
  const f = fixture({ sendFails: true });
  await trigger(f.app).expect(200);
  await trigger(f.app).expect(200);
  assert.equal(f.status(), 'UNKNOWN');
  assert.equal(f.sent(), 1);
  assert.equal(f.booking.status, 'PAID');
  const missing = fixture({ configured: false });
  await trigger(missing.app).expect(500);
  assert.equal(missing.status(), undefined);
});

test('email includes booking details without passenger or luggage fields', () => {
  const { booking } = fixture();
  const text = bookingEmailContent(booking).text;
  for (const value of ['Test Customer', 'Sedan', 'SGD 110.00']) { assert.ok(text.includes(value)); }
  const { html } = bookingEmailContent(booking);
  assert.doesNotMatch(text, /pax|luggage/i);
  assert.doesNotMatch(html, /pax|luggage/i);
});

test('checkout rejects removed passenger and luggage fields', () => {
  const input = { customer: { name: 'Test', email: 'test@example.com', phone: '+6591234567' },
    vehicle_id: 1, service_id: 1, pickup: { address: 'Airport' }, drop: { address: 'Hotel' },
    add_ons: [], payment_method: 'STRIPE' };
  assert.deepEqual(validateCheckout(input), []);
  assert.equal(Object.hasOwn(normalizeCheckout(input), 'pax'), false);
  assert.equal(Object.hasOwn(normalizeCheckout(input), 'luggage'), false);
  assert.ok(validateCheckout({ ...input, pax: 2 }).length);
  assert.ok(validateCheckout({ ...input, luggage: 1 }).length);
});
