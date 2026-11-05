import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { stripePaymentProvider } from '../src/modules/bookings/stripe-payment.js';

const input = { customer: { name: 'John Smith', email: 'john@example.com', phone: '+6591234567' },
  vehicle_id: 3, service_id: 1, pickup: { address: 'Changi Airport Terminal 1' }, drop: { address: 'Marina Bay Sands' },
  add_ons: [{ add_on_id: 2, quantity: 1 }, { add_on_id: 3, quantity: 1 }, { add_on_id: 4, quantity: 2 }], payment_method: 'STRIPE' };
const catalog = { vehicle_name: 'Alphard', service_name: 'Arrival', catalog_id: 12, price: '80.00',
  currency: 'SGD', unit: 'trip', is_from: false,
  add_ons: [{ id: 2, code: 'MEET_GREET', name: 'Meet & Greet', pricing_type: 'FIXED', price: 20, currency: 'SGD' },
    { id: 3, code: 'BABY_SEAT', name: 'Baby seat', pricing_type: 'FIXED', price: 20, currency: 'SGD' },
    { id: 4, code: 'STOP_WITHIN_2KM', name: 'Stop', pricing_type: 'PER_STOP', price: 10, currency: 'SGD' }],
  distance_rules: [{ id: 2, min_distance_km: 28, max_distance_km: 30, min_inclusive: true, max_inclusive: false,
    surcharge: 5, currency: 'SGD', is_contact_support: false },
  { id: 5, min_distance_km: 35, max_distance_km: null, min_inclusive: false, max_inclusive: false,
    surcharge: 0, currency: 'SGD', is_contact_support: true }] };
const webhookSecret = 'whsec_local_test_only';

function fixture({ distanceProvider = async () => 29400, paymentProvider, catalogValue = catalog,
  logger = { info() {}, error() {} } } = {}) {
  const bookings = new Map();
  let catalogCalls = 0, sessionCalls = 0;
  const provider = paymentProvider ?? {
    assertCheckoutReady() {},
    async createCheckout(booking) {
      sessionCalls++;
      return { id: 'cs_test_' + booking.id, url: 'https://checkout.stripe.com/test',
        expires_at: Math.floor(new Date(booking.checkout_expires_at).getTime() / 1000), livemode: false };
    },
  };
  const store = {
    async getQuoteCatalog() { catalogCalls++; return catalogValue; },
    async getCheckoutByKey(key) { return bookings.get(key) ?? null; },
    async createCheckoutBooking(body, quote, key, hash) {
      const booking = { id: randomUUID(), booking_number: 'BK20261003001', status: 'PENDING_PAYMENT',
        request_hash: hash, customer_email: body.customer.email, total_amount_minor: Math.round(quote.total_amount * 100),
        card_surcharge_minor: Math.round((quote.card_surcharge_amount ?? 0) * 100),
        currency: quote.currency, quote_snapshot: quote, checkout_expires_at: new Date(Date.now() + 3600000),
        stripe_session_id: null, stripe_checkout_url: null };
      bookings.set(key, booking);
      return booking;
    },
    async saveCheckoutSession(id, session) {
      const booking = [...bookings.values()].find(item => item.id === id);
      Object.assign(booking, { stripe_session_id: session.id, stripe_checkout_url: session.url });
      return booking;
    },
  };
  return { app: createApp({ logger, vehicleStore: store, distanceProvider, paymentProvider: provider }),
    bookings, get catalogCalls() { return catalogCalls; }, get sessionCalls() { return sessionCalls; } };
}

test('checkout recalculates fare, saves a snapshot and returns a Stripe URL on both prefixes', async () => {
  const f = fixture();
  for (const prefix of ['/api', '/api/v1']) {
    const { body, headers } = await request(f.app).post(`${prefix}/bookings/checkout`).send(input).expect(200);
    assert.deepEqual(body, { success: true, booking_id: 'BK20261003001', payment_status: 'PENDING',
      amount: 159.5, subtotal_amount: 145, card_surcharge_amount: 14.5, card_surcharge_percent: 10,
      currency: 'SGD', stripe_checkout_url: 'https://checkout.stripe.com/test' });
    assert.equal(headers['cache-control'], 'no-store');
    assert.ok(headers['idempotency-key']);
    assert.equal(Object.hasOwn(body, 'customer'), false);
    const saved = f.bookings.get(headers['idempotency-key']);
    assert.equal(saved.quote_snapshot.distance_amount, 5);
    assert.equal(saved.quote_snapshot.add_on_amount, 60);
  }
});

test('checkout rejects frontend prices and invalid customer information before creating bookings', async () => {
  const f = fixture();
  for (const body of [{ ...input, amount: 125 }, { ...input, currency: 'SGD' }, { ...input, customer: null },
    { ...input, customer: { ...input.customer, email: 'bad' } }, { ...input, customer: { ...input.customer, phone: '+65XXXXXXXX' } },
    { ...input, customer: { ...input.customer, name: ' ' } }, { ...input, payment_method: 'CASH' }]) {
    await request(f.app).post('/api/bookings/checkout').send(body).expect(400);
  }
  await request(f.app).post('/api/bookings/checkout').set('Idempotency-Key', 'bad').send(input).expect(400);
  await request(f.app).post('/api/bookings/checkout').type('text').send('hello').expect(415);
  assert.equal(f.bookings.size, 0);
  assert.equal(f.catalogCalls, 0);
});

test('checkout retries reuse the booking/session and reject changed input or completed bookings', async () => {
  const f = fixture();
  const key = randomUUID();
  const send = body => request(f.app).post('/api/bookings/checkout').set('Idempotency-Key', key).send(body);
  const first = await send(input).expect(200);
  const second = await send({ ...input, add_ons: [...input.add_ons].reverse() }).expect(200);
  assert.deepEqual(first.body, second.body);
  assert.equal(f.bookings.size, 1);
  assert.equal(f.catalogCalls, 1);
  assert.equal(f.sessionCalls, 1);
  await send({ ...input, customer: { ...input.customer, name: 'Someone else' } }).expect(409);
  f.bookings.get(key).status = 'PAID';
  await send(input).expect(409);
});

test('retry after a Stripe timeout reuses the saved fare, and expired attempts cannot create sessions', async () => {
  let calls = 0;
  const f = fixture({ paymentProvider: { assertCheckoutReady() {}, async createCheckout(booking) {
    calls++;
    if (calls === 1) { throw Object.assign(new Error('Timeout'), { code: 'PAYMENT_UNAVAILABLE' }); }
    return { id: 'cs_test_retry', url: 'https://checkout.stripe.com/retry', expires_at: Math.floor(new Date(booking.checkout_expires_at).getTime() / 1000), livemode: false };
  } } });
  const key = randomUUID();
  const send = () => request(f.app).post('/api/bookings/checkout').set('Idempotency-Key', key).send(input);
  await send().expect(503);
  await send().expect(200);
  assert.equal(f.bookings.size, 1);
  assert.equal(f.catalogCalls, 1);
  f.bookings.get(key).checkout_expires_at = new Date(Date.now() - 1000);
  await send().expect(409);
  assert.equal(calls, 2);
});

test('contact-support routes and missing Stripe configuration create no booking', async () => {
  const f = fixture({ distanceProvider: async () => 38700 });
  const { body } = await request(f.app).post('/api/bookings/checkout').send(input).expect(200);
  assert.equal(body.quote_status, 'CONTACT_SUPPORT');
  assert.equal(Object.hasOwn(body, 'payment'), false);
  assert.equal(f.bookings.size, 0);
  const disabled = fixture({ paymentProvider: stripePaymentProvider({ secretKey: '', webhookSecret: '' }) });
  await request(disabled.app).post('/api/bookings/checkout').send(input).expect(503);
  assert.equal(disabled.bookings.size, 0);
  assert.equal(disabled.catalogCalls, 0);
});

test('Stripe SDK receives the stored total and a stable session idempotency key', async () => {
  const booking = { id: randomUUID(), booking_number: 'BK20261003001', currency: 'SGD', total_amount_minor: '14500',
    customer_email: input.customer.email, customer_name: input.customer.name, customer_phone: input.customer.phone,
    quote_snapshot: { vehicle: { name: 'Alphard' }, service: { name: 'Arrival' } },
    checkout_expires_at: new Date(Date.now() + 3600000) };
  const provider = stripePaymentProvider({ webhookSecret, successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
    cancelUrl: 'https://example.com/cancel', client: { checkout: { sessions: { async create(params, options) {
      assert.equal(params.line_items[0].price_data.unit_amount, 14500);
      assert.equal(params.line_items[0].price_data.currency, 'sgd');
      assert.equal(params.customer_email, input.customer.email);
      assert.deepEqual(params.metadata, { booking_id: booking.booking_number, booking_uuid: booking.id,
        customer_name: input.customer.name, customer_phone: input.customer.phone, customer_email: input.customer.email });
      assert.deepEqual(params.payment_intent_data.metadata, params.metadata);
      assert.equal(params.line_items[0].price_data.product_data.name, 'Vehicle Booking - BK20261003001');
      assert.equal(params.client_reference_id, booking.id);
      assert.equal(params.mode, 'payment');
      assert.deepEqual(params.invoice_creation, { enabled: false });
      assert.deepEqual(params.allowed_payment_method_types, ['card']);
      assert.equal(Object.hasOwn(params, 'payment_method_types'), false);
      assert.deepEqual(params.adaptive_pricing, { enabled: false });
      assert.deepEqual(params.automatic_tax, { enabled: false });
      assert.equal(params.allow_promotion_codes, false);
      assert.equal(options.idempotencyKey, `booking-checkout-${booking.id}`);
      return { id: 'cs_test_sdk', url: 'https://checkout.stripe.com/test', amount_total: 14500, currency: 'sgd',
        expires_at: params.expires_at, livemode: false };
    } } } } });
  assert.equal((await provider.createCheckout(booking)).id, 'cs_test_sdk');
});

test('Stripe failures log structured diagnostics with the API request ID without exposing raw errors', async () => {
  const logs = [];
  const paymentProvider = stripePaymentProvider({ webhookSecret, successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel', client: { checkout: { sessions: { async create() {
      throw Object.assign(new Error('Invalid API Key provided: sk_test_private'), {
        type: 'StripeAuthenticationError', code: 'api_key_expired', statusCode: 401, requestId: 'req_stripe_test',
        raw: { customer_email: input.customer.email },
      });
    } } } } });
  const f = fixture({ paymentProvider, logger: { info() {}, error(value) { logs.push(JSON.parse(value)); } } });
  const { body } = await request(f.app).post('/api/v1/bookings/checkout').send(input).expect(503);
  assert.equal(body.error.code, 'PAYMENT_UNAVAILABLE');
  assert.deepEqual(logs, [{ event: 'stripe_checkout_failed', requestId: body.requestId, code: 'PAYMENT_UNAVAILABLE',
    stripe: { type: 'StripeAuthenticationError', code: 'api_key_expired', statusCode: 401, requestId: 'req_stripe_test' } }]);
  assert.equal(JSON.stringify({ logs, body }).includes('sk_test_private'), false);
  assert.equal(JSON.stringify({ logs, body }).includes(input.customer.email), false);
});

test('webhook signature verification uses the untouched body and rejects invalid signatures', async () => {
  const handled = [];
  const provider = stripePaymentProvider({ webhookSecret });
  const app = createApp({ logger: { info() {}, error() {} }, paymentProvider: provider,
    vehicleStore: { async applyStripeEvent(event) { handled.push(event); } } });
  const event = { id: 'evt_test_verified', type: 'checkout.session.completed', data: { object: { payment_status: 'paid' } } };
  const payload = JSON.stringify(event, null, 2);
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
  for (const prefix of ['/api', '/api/v1']) {
    await request(app).post(`${prefix}/payments/stripe/webhook`).set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature).send(payload).expect(200);
  }
  assert.equal(handled.length, 2);
  assert.deepEqual(handled[0], event);
  await request(app).post('/api/payments/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', 'invalid').send(payload).expect(400);
  await request(app).post('/api/payments/stripe/webhook').set('Content-Type', 'application/json')
    .set('Stripe-Signature', signature).send(payload.replace('paid', 'unpaid')).expect(400);
  assert.equal(handled.length, 2);
});
