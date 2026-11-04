import { Router } from 'express';
import { requireAdmin } from '../../middleware/admin.js';
import { sendError } from '../../middleware/errors.js';
import { validateAddOn, validateQuote } from './add-on.validation.js';
import { calculateQuote, applyDistancePricing } from './quote.js';
import { validateDistanceRule } from './distance-rule.validation.js';

export function addOnRoutes({ vehicleStore: store, adminApiKey, adminAuth, distanceProvider }) {
  const router = Router();
  const authorize = requireAdmin(adminApiKey, adminAuth);
  const invalid = (req, res, details) => sendError(req, res, 400, 'INVALID_INPUT', 'Check the submitted details.', details);
  const handle = handler => async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try { return await handler(req, res); }
    catch (err) {
      if (err.code === '23505') { return sendError(req, res, 409, 'ALREADY_EXISTS', 'Add-on code already exists.'); }
      if (err.code === 'INVALID_INPUT') { return invalid(req, res, err.details); }
      if (err.code === 'NOT_FOUND') { return sendError(req, res, 404, 'NOT_FOUND', err.message); }
      if (err.code === 'QUOTE_UNAVAILABLE') { return sendError(req, res, 409, err.code, err.message); }
      if (['DISTANCE_UNAVAILABLE', 'DISTANCE_PRICING_UNAVAILABLE'].includes(err.code)) { return sendError(req, res, 503, err.code, err.message); }
      if (err.code === 'ROUTE_NOT_FOUND') { return sendError(req, res, 422, err.code, err.message); }
      if (err.code === '23P01') { return sendError(req, res, 409, 'OVERLAPPING_RULES', 'Active distance brackets must not overlap.'); }
      if (err.code === '23514') { return invalid(req, res, ['Check distance bounds and surcharge settings.']); }
      return next(err);
    }
  };
  router.get('/add-ons', handle(async (_req, res) => res.json({ success: true, data: await store.listAddOns() })));
  router.post('/add-ons', authorize, handle(async (req, res) => {
    const details = validateAddOn(req.body, true);
    if (details.length) { return invalid(req, res, details); }
    const addOn = await store.createAddOn(req.body);
    return res.status(201).json({ success: true, add_on: addOn });
  }));
  router.patch('/add-ons/:id', authorize, handle(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) { return sendError(req, res, 404, 'NOT_FOUND', 'Add-on not found.'); }
    const details = validateAddOn(req.body);
    if (details.length) { return invalid(req, res, details); }
    const addOn = await store.updateAddOn(id, req.body);
    if (!addOn) { return sendError(req, res, 404, 'NOT_FOUND', 'Add-on not found.'); }
    return res.json({ success: true, add_on: addOn });
  }));
  router.delete('/add-ons/:id', requireAdmin(adminApiKey, adminAuth, { requireJson: false }), handle(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) { return sendError(req, res, 404, 'NOT_FOUND', 'Add-on not found.'); }
    try {
      const deleted = await store.deleteAddOn(id);
      return deleted ? res.status(204).end() : sendError(req, res, 404, 'NOT_FOUND', 'Add-on not found.');
    } catch (err) {
      if (err.code === '23503') {
        return sendError(req, res, 409, 'ADD_ON_IN_USE', 'This add-on is used by bookings that are not COMPLETED. Set its status to INACTIVE instead.');
      }
      throw err;
    }
  }));
  router.post('/booking/quote', handle(async (req, res) => {
    if (!req.is('application/json')) { return sendError(req, res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send Content-Type: application/json.'); }
    const details = validateQuote(req.body);
    if (details.length) { return invalid(req, res, details); }
    const catalog = await store.getQuoteCatalog(req.body);
    const quote = calculateQuote(req.body, catalog);
    const distanceMeters = await distanceProvider(req.body.pickup, req.body.drop);
    return res.json(applyDistancePricing(req.body, quote, catalog.distance_rules, distanceMeters));
  }));
  router.get('/distance-pricing-rules', authorize, handle(async (_req, res) => res.json({ success: true, data: await store.listDistanceRules() })));
  router.post('/distance-pricing-rules', authorize, handle(async (req, res) => {
    const details = validateDistanceRule(req.body, true);
    if (details.length) { return invalid(req, res, details); }
    return res.status(201).json({ success: true, distance_rule: await store.createDistanceRule(req.body) });
  }));
  router.patch('/distance-pricing-rules/:id', authorize, handle(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) { return sendError(req, res, 404, 'NOT_FOUND', 'Distance pricing rule not found.'); }
    const details = validateDistanceRule(req.body);
    if (details.length) { return invalid(req, res, details); }
    const rule = await store.updateDistanceRule(id, req.body);
    if (!rule) { return sendError(req, res, 404, 'NOT_FOUND', 'Distance pricing rule not found.'); }
    return res.json({ success: true, distance_rule: rule });
  }));
  return router;
}
