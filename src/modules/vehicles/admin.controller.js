import { sendError } from '../../middleware/errors.js';
import { validateVehicleUpdate, validateService, validatePrice } from './admin.validation.js';

export function adminController(store) {
  const invalid = (req, res, details) => sendError(req, res, 400, 'INVALID_INPUT', 'Check the submitted details.', details);
  const handle = handler => async (req, res, next) => {
    try { return await handler(req, res); }
    catch (err) {
      if (err.code === '23503' || err.code === 'NOT_FOUND') { return sendError(req, res, 404, 'NOT_FOUND', 'Referenced vehicle type or service not found.'); }
      if (err.code === 'INVALID_INPUT' || err.code === '23514') { return invalid(req, res, err.details ?? ['Check the price validity and service settings.']); }
      if (err.code === '23505') { return sendError(req, res, 409, 'ALREADY_EXISTS', 'This name or service code already exists.'); }
      return next(err);
    }
  };
  const typeDetails = (body, creating) => {
    const details = validateVehicleUpdate(body);
    for (const key of Object.keys(body ?? {})) { if (!['name', 'description'].includes(key)) { details.push(key + ' is not supported.'); } }
    if (creating && !body?.name) { details.push('name is required.'); }
    return details;
  };
  return {
    createType: handle(async (req, res) => {
      const details = typeDetails(req.body, true);
      if (details.length) { return invalid(req, res, details); }
      return res.status(201).json({ vehicleType: await store.createType(req.body) });
    }),
    updateType: handle(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1 || id > 2147483647) { return sendError(req, res, 404, 'NOT_FOUND', 'Vehicle type not found.'); }
      const details = typeDetails(req.body, false);
      if (details.length) { return invalid(req, res, details); }
      const vehicleType = await store.updateType(id, req.body);
      if (!vehicleType) { return sendError(req, res, 404, 'NOT_FOUND', 'Vehicle type not found.'); }
      return res.json({ vehicleType });
    }),
    updateVehicle: handle(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1 || id > 2147483647) { return sendError(req, res, 404, 'NOT_FOUND', 'Vehicle not found.'); }
      const details = validateVehicleUpdate(req.body);
      if (details.length) { return invalid(req, res, details); }
      const vehicle = await store.updateVehicle(id, req.body);
      if (!vehicle) { return sendError(req, res, 404, 'NOT_FOUND', 'Vehicle not found.'); }
      return res.json({ vehicle });
    }),
    setPrice: handle(async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1 || id > 2147483647) { return sendError(req, res, 404, 'NOT_FOUND', 'Vehicle not found.'); }
      const service = (await store.listServices()).find(item => item.code === req.params.service);
      if (!service) { return sendError(req, res, 404, 'NOT_FOUND', 'Service not found.'); }
      const details = validatePrice(req.body, service);
      if (details.length) { return invalid(req, res, details); }
      const vehicle = await store.setPrice(id, service.code, req.body);
      if (!vehicle) { return sendError(req, res, 404, 'NOT_FOUND', 'Vehicle not found.'); }
      return res.json({ vehicle });
    }),
    createService: handle(async (req, res) => {
      const details = validateService(req.body, true);
      if (details.length) { return invalid(req, res, details); }
      const service = await store.createService(req.body);
      return res.status(201).json({ service });
    }),
    updateService: handle(async (req, res) => {
      const details = validateService(req.body);
      if (details.length) { return invalid(req, res, details); }
      const service = await store.updateService(req.params.code, req.body);
      if (!service) { return sendError(req, res, 404, 'NOT_FOUND', 'Service not found.'); }
      return res.json({ service });
    }),
  };
}
