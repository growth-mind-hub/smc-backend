import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCardSurcharge } from '../src/modules/bookings/card-surcharge.js';
import { stripePaymentProvider } from '../src/modules/bookings/stripe-payment.js';

test('card surcharge rounds to cents and preserves the original fare breakdown', () => {
  const quote = { total_amount: 100.05, vehicle_amount: 80, distance_amount: 5, add_on_amount: 15.05 };
  const result = applyCardSurcharge(quote);
  assert.equal(result.card_surcharge_amount, 10.01);
  assert.equal(result.total_amount, 110.06);
  assert.equal(result.subtotal_amount, 100.05);
  assert.equal(result.vehicle_amount, 80);
  assert.equal(quote.total_amount, 100.05);
});

test('Stripe gets an itemized surcharge matching the persisted final total', async () => {
  const booking = { id: 'test', booking_number: 'BK123', total_amount_minor: '11000', card_surcharge_minor: '1000',
    currency: 'SGD', checkout_expires_at: new Date(Date.now() + 3600000), quote_snapshot: { vehicle: { name: 'Car' }, service: { name: 'Arrival' } } };
  const provider = stripePaymentProvider({ webhookSecret: 'test', successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel', client: { checkout: { sessions: { async create(params) {
      assert.deepEqual(params.line_items.map(item => item.price_data.unit_amount), [10000, 1000]);
      assert.equal(params.line_items[1].price_data.product_data.name, 'Card payment surcharge (10%)');
      return { id: 'cs_test', url: 'https://checkout.stripe.com/test', expires_at: params.expires_at,
        livemode: false, amount_total: 11000, currency: 'sgd' };
    } } } } });
  assert.equal((await provider.createCheckout(booking)).id, 'cs_test');
});
