import { validateVehicle } from './vehicle.validation.js';
import { minimumPrice } from './minimum-price.js';
import { sendError as error } from '../../middleware/errors.js';
import { parseRequirements, annotateVehicles } from '../recommendations/vehicle-list-recommendation.js';

export function vehicleController({ vehicleStore }) {
  return {
    listMinimumPrices: async (_req, res) => {
      const vehicles = await vehicleStore.list();
      const data = vehicles.map(vehicle => ({
        id: vehicle.id, name: vehicle.name, description: vehicle.description,
        imageUrl: vehicle.imageUrl, passengerCapacity: vehicle.passengerCapacity,
        luggageCapacity: vehicle.luggageCapacity, minimumPrice: minimumPrice(vehicle),
      }));
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ success: true, data });
    },
    getCatalogEntry: async (req, res) => {
      const id = Number(req.params.id);
      const catalog = Number.isInteger(id) && id > 0 && id <= 2147483647
        ? await vehicleStore.getCatalogEntry(id) : null;
      if (!catalog) { return error(req, res, 404, 'NOT_FOUND', 'Catalog entry not found.'); }
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ catalog });
    },
    listServices: async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ services: await vehicleStore.listServices() });
    },
    listVehicles: async (req, res) => {
      const { requirements, details } = parseRequirements(req.query);
      if (details.length) { return error(req, res, 400, 'INVALID_INPUT', 'Check passenger and luggage counts.', details); }
      const { data } = annotateVehicles(await vehicleStore.list(), requirements);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ success: true, requirements, data });
    },
    getVehicle: async (req, res) => {
    const id = Number(req.params.id);
    const vehicle = Number.isSafeInteger(id) && id > 0 ? await vehicleStore.get(id) : null;
    if (!vehicle) {return error(req, res, 404, 'NOT_FOUND', 'Vehicle not found.');}
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ vehicle });
    },
    createVehicle: async (req, res, next) => {
    const details = validateVehicle(req.body, await vehicleStore.listServices());
    if (details.length) {return error(req, res, 400, 'INVALID_INPUT', 'Check the vehicle details and prices.', details);}
    try {
      const vehicle = await vehicleStore.create({ ...req.body, name: req.body.name.trim() });
      return res.status(201).location(`/api/v1/vehicles/${vehicle.id}`).json({ vehicle });
    } catch (err) {
      if (err.code === '23503') { return error(req, res, 404, 'NOT_FOUND', 'Vehicle type not found.'); }
      if (err.code === 'INVALID_INPUT') {return error(req, res, 400, 'INVALID_INPUT', 'Check the vehicle details and prices.', err.details);}
      if (err.code === '23505') {return error(req, res, 409, 'VEHICLE_EXISTS', 'A vehicle with this name already exists.');}
      return next(err);
    }
    },
  };
}
