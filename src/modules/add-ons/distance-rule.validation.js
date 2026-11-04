export function validateDistanceRule(body, creating = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length) { return ['A nonempty JSON object is required.']; }
  const errors = [];
  const allowed = ['min_distance_km', 'max_distance_km', 'min_inclusive', 'max_inclusive', 'surcharge', 'currency', 'is_contact_support', 'status'];
  for (const key of Object.keys(body)) { if (!allowed.includes(key)) { errors.push(`${key} is not supported.`); } }
  for (const key of ['min_distance_km', 'max_distance_km']) {
    if (key === 'max_distance_km' && body[key] === null) { continue; }
    if ((creating && key === 'min_distance_km') || key in body) {
      if (typeof body[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < 0 || body[key] > 9999999 || Math.abs(body[key] * 1000 - Math.round(body[key] * 1000)) > 0.000001) { errors.push(`${key} must be a nonnegative distance with at most three decimal places.`); }
    }
  }
  if (body.max_distance_km != null && body.min_distance_km != null && body.max_distance_km <= body.min_distance_km) { errors.push('max_distance_km must be greater than min_distance_km.'); }
  if ('surcharge' in body && (typeof body.surcharge !== 'number' || !Number.isFinite(body.surcharge) || body.surcharge < 0 || body.surcharge > 1000000 || Math.abs(body.surcharge * 100 - Math.round(body.surcharge * 100)) > 0.000001)) { errors.push('surcharge must be between 0 and 1000000 with at most two decimal places.'); }
  for (const key of ['min_inclusive', 'max_inclusive', 'is_contact_support']) { if (key in body && typeof body[key] !== 'boolean') { errors.push(`${key} must be boolean.`); } }
  if ('currency' in body && (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency))) { errors.push('currency must be a three-letter uppercase code.'); }
  if ('status' in body && !['ACTIVE', 'INACTIVE'].includes(body.status)) { errors.push('status must be ACTIVE or INACTIVE.'); }
  if (body.is_contact_support === true && body.surcharge !== undefined && body.surcharge !== 0) { errors.push('Contact-support rules must have surcharge 0.'); }
  return errors;
}
