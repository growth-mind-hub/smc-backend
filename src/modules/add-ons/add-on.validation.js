const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => Number.isInteger(value) && value > 0 && value <= 2147483647;

export function validateAddOn(body, creating = false) {
  if (!object(body) || !Object.keys(body).length) { return ['A nonempty JSON object is required.']; }
  const errors = [];
  const fields = ['name', 'description', 'pricing_type', 'price', 'currency', 'status'];
  if (creating) { fields.push('code'); }
  for (const key of Object.keys(body)) { if (!fields.includes(key)) { errors.push(`${key} is not supported.`); } }
  if (creating && (typeof body.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,49}$/.test(body.code))) { errors.push('code must be 1 to 50 uppercase letters, digits or underscores, starting with a letter.'); }
  if ((creating || 'name' in body) && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 150)) { errors.push('name must contain 1 to 150 characters.'); }
  if ('description' in body && (typeof body.description !== 'string' || body.description.length > 1000)) { errors.push('description must be a string of at most 1000 characters.'); }
  if ((creating || 'pricing_type' in body) && !['FIXED', 'PER_STOP'].includes(body.pricing_type)) { errors.push('pricing_type must be FIXED or PER_STOP.'); }
  if ((creating || 'price' in body) && (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0 || body.price > 1000000 || Math.abs(body.price * 100 - Math.round(body.price * 100)) > 0.000001)) { errors.push('price must be between 0 and 1000000 with at most two decimal places.'); }
  if ('currency' in body && (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency))) { errors.push('currency must be a three-letter uppercase code.'); }
  if ('status' in body && !['ACTIVE', 'INACTIVE'].includes(body.status)) { errors.push('status must be ACTIVE or INACTIVE.'); }
  return errors;
}

export function validateQuote(body) {
  if (!object(body)) { return ['A JSON object is required.']; }
  const errors = [];
  for (const key of Object.keys(body)) { if (!['vehicle_id', 'service_id', 'pickup', 'drop', 'add_ons', 'hours'].includes(key)) { errors.push(`${key} is not supported.`); } }
  for (const key of ['pickup', 'drop']) {
    const location = body[key];
    if (!object(location) || Object.keys(location).some(field => field !== 'address') ||
      typeof location.address !== 'string' || !location.address.trim() || location.address.length > 500) {
      errors.push(`${key} must contain only a nonempty address of at most 500 characters.`);
    }
  }
  for (const key of ['vehicle_id', 'service_id']) { if (!id(body[key])) { errors.push(`${key} must be a positive integer.`); } }
  if ('hours' in body && (!Number.isInteger(body.hours) || body.hours < 1 || body.hours > 24)) { errors.push('hours must be an integer between 1 and 24.'); }
  if (!Array.isArray(body.add_ons) || body.add_ons.length > 100) { errors.push('add_ons must be an array of at most 100 selections.'); }
  else {
    const seen = new Set();
    for (const item of body.add_ons) {
      if (!object(item) || Object.keys(item).some(key => !['add_on_id', 'quantity'].includes(key)) || !id(item.add_on_id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
        errors.push('Each add-on must contain only a positive add_on_id and quantity between 1 and 100.');
      } else if (seen.has(item.add_on_id)) { errors.push('Duplicate add_on_id selections are not allowed.'); }
      else { seen.add(item.add_on_id); }
    }
  }
  return errors;
}
