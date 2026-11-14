import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { validateCheckout, normalizeCheckout } from '../src/modules/bookings/checkout.validation.js';

function fixture({ consent = true, paid = true, cancelled = false, emailFails = false, whatsappFails = false,
  type = 'checkout.session.completed' } = {}) {
  let notification, sends = 0;
  const booking = { id: 'a181390c-b26b-4718-a634-3edfdd3d3cbe', status: paid ? 'PAID' : 'PENDING_PAYMENT',
    booking_status: cancelled ? 'CANCELLED' : 'CONFIRMED', whatsapp_opt_in: consent };
  const app = createApp({ logger: { info() {}, error() {} },
    paymentProvider: { verifyWebhook() { return { type, data: { object: { payment_status: paid ? 'paid' : 'unpaid' } } }; } },
    mailer: { assertReady() { if (emailFails) { throw new Error('email config missing'); } }, async sendConfirmation() { return 'email-test'; } },
    whatsapp: { assertReady() {}, async sendConfirmation(actual) {
      assert.equal(actual.id, booking.id); sends++; if (whatsappFails) { throw new Error('timeout'); } return 'wamid.test';
    } },
    vehicleStore: {
      async applyStripeEvent() { return { status: booking.status, booking_id: booking.id }; },
      async getBooking() { return booking; },
      async claimEmailConfirmation() { return false; }, async getEmailConfirmation() { return { status: 'ACCEPTED' }; },
      async claimWhatsappConfirmation() { if (notification) { return false; } notification = { status: 'PENDING' }; return true; },
      async getWhatsappConfirmation() { return notification; },
      async finishWhatsappConfirmation(_id, status) { notification = { status }; },
    } });
  return { app, sends: () => sends, status: () => notification?.status };
}
const trigger = app => request(app).post('/api/v1/payments/stripe/webhook').set('Content-Type', 'application/json').send('{}');

test('paid Stripe events trigger one WhatsApp confirmation despite repeated callbacks', async () => {
  for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) {
    const f = fixture({ type });
    await trigger(f.app).expect(200);
    await trigger(f.app).expect(200);
    assert.equal(f.sends(), 1);
    assert.equal(f.status(), 'ACCEPTED');
  }
});
test('no consent, unpaid, cancelled and failed-payment events never send WhatsApp', async () => {
  for (const options of [{ consent: false }, { paid: false }, { cancelled: true }, { type: 'checkout.session.async_payment_failed' }]) {
    const f = fixture(options);
    await trigger(f.app).expect(200);
    assert.equal(f.sends(), 0);
  }
});
test('email configuration failure does not stop WhatsApp, and a retry does not duplicate it', async () => {
  const f = fixture({ emailFails: true });
  await trigger(f.app).expect(500);
  await trigger(f.app).expect(500);
  assert.equal(f.sends(), 1);
});
test('uncertain WhatsApp sends are recorded for review without automatic resending', async () => {
  const f = fixture({ whatsappFails: true });
  await trigger(f.app).expect(200);
  await trigger(f.app).expect(200);
  assert.equal(f.sends(), 1);
  assert.equal(f.status(), 'UNKNOWN');
});
test('checkout consent is optional, boolean and preserved in normalized input', () => {
  const input = { customer: { name: 'Test', email: 'test@example.com', phone: '+6591234567' }, vehicle_id: 1, service_id: 1,
    pickup: { address: 'Airport' }, drop: { address: 'Hotel' }, add_ons: [], payment_method: 'STRIPE' };
  assert.deepEqual(validateCheckout({ ...input, whatsapp_opt_in: true }), []);
  assert.equal(normalizeCheckout({ ...input, whatsapp_opt_in: true }).whatsapp_opt_in, true);
  assert.equal(Object.hasOwn(normalizeCheckout(input), 'whatsapp_opt_in'), false);
  assert.ok(validateCheckout({ ...input, whatsapp_opt_in: 'true' }).length);
});
