import { sendError } from '../../middleware/errors.js';
import { parseRequirements, annotateVehicles } from './vehicle-list-recommendation.js';

export function homepageRecommendation(vehicleStore) {
  return async (req, res) => {
    const { requirements, details } = parseRequirements(req.query);
    if (!requirements) { details.push('persons and luggage are required.'); }
    if (details.length) { return sendError(req, res, 400, 'INVALID_INPUT', 'Check passenger and luggage counts.', details); }
    const { data } = annotateVehicles(await vehicleStore.list(), requirements);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, requirements, data });
  };
}
