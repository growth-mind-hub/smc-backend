import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { sendError } from '../../middleware/errors.js';
import { validateCheckout, normalizeCheckout } from './checkout.validation.js';
import { calculateQuote, applyDistancePricing } from '../add-ons/quote.js';
import { applyCardSurcharge } from './card-surcharge.js';
import { sendPaidBookingEmail } from './booking-email.js';

const failure = (code, message) => Object.assign(new Error(message), { code });
const checkoutResponse = booking => ({ success: true,
  booking_id: booking.booking_number,
  payment_status: booking.status === 'PENDING_PAYMENT' ? 'PENDING' : booking.status,
  amount: Number(booking.total_amount_minor) / 100, currency: booking.currency,
  subtotal_amount: (Number(booking.total_amount_minor) - Number(booking.card_surcharge_minor ?? 0)) / 100,
  card_surcharge_amount: Number(booking.card_surcharge_minor ?? 0) / 100,
  card_surcharge_percent: booking.quote_snapshot?.card_surcharge_percent ?? 0,
  stripe_checkout_url: booking.stripe_checkout_url });

export function checkoutRoutes({ vehicleStore: store, distanceProvider, paymentProvider, logger = console }) {
  const router = Router();
  router.post('/bookings/checkout', async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.is('application/json')) { return sendError(req, res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send Content-Type: application/json.'); }
    const details = validateCheckout(req.body, req.get('Idempotency-Key'));
    if (details.length) { return sendError(req, res, 400, 'INVALID_INPUT', 'Check the booking details. Send IDs and customer information, without prices.', details); }
    const input = normalizeCheckout(req.body);
    const key = req.get('Idempotency-Key') ?? randomUUID();
    res.setHeader('Idempotency-Key', key);
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    try {
      paymentProvider.assertCheckoutReady();
      let booking = await store.getCheckoutByKey(key);
      if (booking && booking.request_hash !== requestHash) { throw failure('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for different booking details.'); }
      if (!booking) {
        const catalog = await store.getQuoteCatalog(input);
        const baseQuote = calculateQuote(input, catalog);
        const distanceMeters = await distanceProvider(input.pickup, input.drop);
        const result = applyDistancePricing(input, baseQuote, catalog.distance_rules, distanceMeters);
        if (result.quote_status === 'CONTACT_SUPPORT') { return res.json(result); }
        const quote = applyCardSurcharge(result.quote);
        const totalMinor = Math.round(quote.total_amount * 100);
        if (quote.currency !== 'SGD' || !Number.isSafeInteger(totalMinor) || totalMinor < 50 || totalMinor > 99999999) {
          throw failure('CHECKOUT_NOT_SUPPORTED', 'Checkout requires an SGD total between 0.50 and 999999.99.');
        }
        booking = await store.createCheckoutBooking(input, quote, key, requestHash);
      }
      if (booking.status !== 'PENDING_PAYMENT') { throw failure('BOOKING_NOT_PENDING', 'This booking is no longer awaiting payment.'); }
      const remaining = new Date(booking.checkout_expires_at).getTime() - Date.now();
      if (remaining <= 0 || (!booking.stripe_session_id && remaining < 30 * 60000)) {
        throw failure('CHECKOUT_EXPIRED', 'This checkout attempt has expired. Start a new checkout using a new Idempotency-Key.');
      }
      if (!booking.stripe_session_id) {
        const session = await paymentProvider.createCheckout(booking);
        booking = await store.saveCheckoutSession(booking.id, session);
      }
      return res.json(checkoutResponse(booking));
    } catch (err) {
      if (err.code === 'PAYMENT_UNAVAILABLE') {
        logger.error(JSON.stringify({ event: 'stripe_checkout_failed', requestId: req.requestId,
          code: err.code, stripe: err.stripeError }));
      }
      if (['INVALID_INPUT', 'CHECKOUT_NOT_SUPPORTED'].includes(err.code)) { return sendError(req, res, 400, err.code, err.message, err.details); }
      if (err.code === 'NOT_FOUND') { return sendError(req, res, 404, err.code, err.message); }
      if (['IDEMPOTENCY_CONFLICT', 'BOOKING_NOT_PENDING', 'CHECKOUT_EXPIRED', 'QUOTE_UNAVAILABLE'].includes(err.code)) { return sendError(req, res, 409, err.code, err.message); }
      if (['PAYMENT_NOT_CONFIGURED', 'PAYMENT_UNAVAILABLE', 'DISTANCE_UNAVAILABLE', 'DISTANCE_PRICING_UNAVAILABLE'].includes(err.code)) { return sendError(req, res, 503, err.code, err.message); }
      if (err.code === 'ROUTE_NOT_FOUND') { return sendError(req, res, 422, err.code, err.message); }
      return next(err);
    }
  });
  return router;
}

export function stripeWebhook({ vehicleStore: store, paymentProvider, mailer, logger = console }) {
  return async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const event = paymentProvider.verifyWebhook(req.body, req.get('Stripe-Signature'));
      const result = await store.applyStripeEvent(event);
      if (result?.status === 'PAID' && result.booking_id &&
        ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) &&
        event.data?.object?.payment_status === 'paid') {
        const email = await sendPaidBookingEmail(store, mailer, result.booking_id);
        logger.info(JSON.stringify({ event: 'paid_booking_email', requestId: req.requestId,
          status: email.status ?? 'SKIPPED', duplicate: email.duplicate ?? false }));
      }
      return res.json({ received: true });
    } catch (err) {
      if (err.code === 'INVALID_SIGNATURE') { return sendError(req, res, 400, err.code, err.message); }
      if (err.code === 'PAYMENT_NOT_CONFIGURED') { return sendError(req, res, 503, err.code, err.message); }
      return next(err);
    }
  };
}
