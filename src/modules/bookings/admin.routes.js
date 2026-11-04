import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { validateCheckout, normalizeCheckout } from './checkout.validation.js';
import { calculateQuote, applyDistancePricing } from '../add-ons/quote.js';
import { requireAdmin } from '../../middleware/admin.js';
import { sendError } from '../../middleware/errors.js';

const statuses = ['NEW', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const validId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  || /^BK\d{11,}$/.test(value);
const invalid = (req, res, message) => sendError(req, res, 400, 'INVALID_INPUT', message);

export function bookingAdminRoutes({ vehicleStore: store, adminApiKey, adminAuth, distanceProvider }) {
  const router = Router();
  const authorize = requireAdmin(adminApiKey, adminAuth);
  router.use('/bookings', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.post('/bookings', authorize, async (req, res, next) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) { return invalid(req, res, 'A JSON object is required.'); }
    const { driver_name = '', driver_phone = '', ...details } = body;
    if (Object.hasOwn(details, 'payment_method')) { return invalid(req, res, 'Manual bookings do not accept payment_method.'); }
    const errors = validateCheckout({ ...details, payment_method: 'STRIPE' }, req.get('Idempotency-Key'));
    if (typeof driver_name !== 'string' || typeof driver_phone !== 'string') { errors.push('Driver name and phone must be plain text.'); }
    if (errors.length) { return sendError(req, res, 400, 'INVALID_INPUT', 'Check the manual booking details.', errors); }
    const input = { ...normalizeCheckout(details), payment_method: 'MANUAL', driver_name, driver_phone };
    const key = req.get('Idempotency-Key') ?? randomUUID();
    res.setHeader('Idempotency-Key', key);
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    try {
      let booking = await store.getCheckoutByKey(key);
      if (booking) {
        if (booking.request_hash !== hash || booking.payment_method !== 'MANUAL') {
          return sendError(req, res, 409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for different booking details.');
        }
        return res.json({ booking });
      }
      const catalog = await store.getQuoteCatalog(input);
      const base = calculateQuote(input, catalog);
      const distance = await distanceProvider(input.pickup, input.drop);
      const result = applyDistancePricing(input, base, catalog.distance_rules, distance);
      if (result.quote_status === 'CONTACT_SUPPORT') { return res.json(result); }
      const total = Math.round(result.quote.total_amount * 100);
      if (result.quote.currency !== 'SGD' || !Number.isSafeInteger(total) || total < 50 || total > 99999999) {
        return invalid(req, res, 'Booking total must be between SGD 0.50 and 999999.99.');
      }
      booking = await store.createCheckoutBooking(input, result.quote, key, hash, { manual: true });
      return res.status(201).json({ booking });
    } catch (err) {
      const status = { INVALID_INPUT: 400, NOT_FOUND: 404, IDEMPOTENCY_CONFLICT: 409,
        QUOTE_UNAVAILABLE: 409, ROUTE_NOT_FOUND: 422, DISTANCE_UNAVAILABLE: 503, DISTANCE_PRICING_UNAVAILABLE: 503 }[err.code];
      if (status) { return sendError(req, res, status, err.code, err.message, err.details); }
      return next(err);
    }
  });
  router.get('/bookings', authorize, async (req, res) => {
    const { limit = '50', offset = '0' } = req.query;
    if (Object.keys(req.query).some(key => !['limit', 'offset'].includes(key))
      || typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100
      || typeof offset !== 'string' || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset))) {
      return invalid(req, res, 'Use limit from 1 to 100 and a nonnegative integer offset.');
    }
    return res.json({ bookings: await store.listBookings(Number(limit), Number(offset)) });
  });
  router.get('/bookings/:id', authorize, async (req, res) => {
    if (!validId(req.params.id)) { return invalid(req, res, 'Use a booking UUID or booking number.'); }
    const booking = await store.getBooking(req.params.id);
    return booking ? res.json({ booking }) : sendError(req, res, 404, 'NOT_FOUND', 'Booking not found.');
  });
  router.delete('/bookings/:id', requireAdmin(adminApiKey, adminAuth, { requireJson: false }), async (req, res) => {
    if (!validId(req.params.id)) { return invalid(req, res, 'Use a booking UUID or booking number.'); }
    const deleted = await store.deleteBooking(req.params.id);
    return deleted ? res.status(204).end() : sendError(req, res, 404, 'NOT_FOUND', 'Booking not found.');
  });
  router.patch('/bookings/:id', authorize, async (req, res) => {
    if (!validId(req.params.id)) { return invalid(req, res, 'Use a booking UUID or booking number.'); }
    const body = req.body;
    if (!body || Array.isArray(body) || !Object.keys(body).length
      || Object.keys(body).some(key => !['booking_status', 'driver_name', 'driver_phone'].includes(key))
      || (Object.hasOwn(body, 'booking_status') && !statuses.includes(body.booking_status))) {
      return invalid(req, res, `Send booking_status (${statuses.join(', ')}), driver_name and/or driver_phone.`);
    }
    for (const field of ['driver_name', 'driver_phone']) {
      if (Object.hasOwn(body, field) && typeof body[field] !== 'string') {
        return invalid(req, res, `${field} must be plain text. Send an empty string to clear it.`);
      }
    }
    const update = { ...body };
    const booking = await store.updateBooking(req.params.id, update);
    return booking ? res.json({ booking }) : sendError(req, res, 404, 'NOT_FOUND', 'Booking not found.');
  });
  return router;
}
