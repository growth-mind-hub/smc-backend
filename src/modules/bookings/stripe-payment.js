import Stripe from 'stripe';

const failure = (code, message) => Object.assign(new Error(message), { code });
const validRedirect = value => {
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === 'https:' ||
      (process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
};

export function stripePaymentProvider({ secretKey = process.env.STRIPE_SECRET_KEY,
  webhookSecret = process.env.STRIPE_WEBHOOK_SECRET, successUrl = process.env.STRIPE_SUCCESS_URL,
  cancelUrl = process.env.STRIPE_CANCEL_URL, client } = {}) {
  const stripe = client ?? (secretKey ? new Stripe(secretKey, { timeout: 5000, maxNetworkRetries: 1 }) : null);
  return {
    assertCheckoutReady() {
      if (!stripe || !webhookSecret || !validRedirect(successUrl) || !validRedirect(cancelUrl)) {
        throw failure('PAYMENT_NOT_CONFIGURED', 'Configure Stripe secret key, webhook secret, success URL and cancel URL before checkout.');
      }
    },
    async createCheckout(booking) {
      this.assertCheckoutReady();
      const metadata = { booking_id: booking.booking_number, booking_uuid: booking.id,
        customer_name: booking.customer_name, customer_phone: booking.customer_phone, customer_email: booking.customer_email };
      let session;
      try {
        session = await stripe.checkout.sessions.create({
          // Let Stripe select eligible methods from the Dashboard configuration.
          mode: 'payment',
          invoice_creation: { enabled: false },
          adaptive_pricing: { enabled: false }, automatic_tax: { enabled: false }, allow_promotion_codes: false,
          client_reference_id: booking.id, customer_email: booking.customer_email,
          metadata,
          payment_intent_data: { metadata },
          success_url: successUrl, cancel_url: cancelUrl,
          expires_at: Math.floor(new Date(booking.checkout_expires_at).getTime() / 1000),
          line_items: [{ price_data: { currency: booking.currency.toLowerCase(), unit_amount: Number(booking.total_amount_minor),
            product_data: { name: `Vehicle Booking - ${booking.booking_number}`, description: `${booking.quote_snapshot.vehicle.name} – ${booking.quote_snapshot.service.name}` } }, quantity: 1 }],
        }, { idempotencyKey: `booking-checkout-${booking.id}` });
      } catch (err) {
        const error = failure('PAYMENT_UNAVAILABLE', 'Stripe checkout could not be created. Retry using the same Idempotency-Key.');
        // Keep structured diagnostics only; raw errors can contain keys or customer data.
        error.stripeError = { type: err?.type, code: err?.code, param: err?.param,
          statusCode: err?.statusCode, requestId: err?.requestId };
        throw error;
      }
      if (!session?.id || !session.url || !validRedirect(session.url) || !Number.isInteger(session.expires_at) ||
        typeof session.livemode !== 'boolean' || session.amount_total !== Number(booking.total_amount_minor) || session.currency?.toUpperCase() !== booking.currency) {
        throw failure('PAYMENT_UNAVAILABLE', 'Stripe returned an invalid checkout session. Retry using the same Idempotency-Key.');
      }
      return { id: session.id, url: session.url, expires_at: session.expires_at, livemode: session.livemode };
    },
    verifyWebhook(rawBody, signature) {
      if (!webhookSecret) { throw failure('PAYMENT_NOT_CONFIGURED', 'Stripe webhook secret is not configured.'); }
      try {
        if (!Buffer.isBuffer(rawBody) || !signature) { throw new Error('Missing signature'); }
        return Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
      } catch { throw failure('INVALID_SIGNATURE', 'Invalid Stripe webhook signature.'); }
    },
  };
}
