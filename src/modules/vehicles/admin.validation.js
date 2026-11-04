const isObject = body => body && typeof body === 'object' && !Array.isArray(body);

export function validateVehicleUpdate(body) {
  if (!isObject(body) || !Object.keys(body).length) { return ['A nonempty JSON object is required.']; }
  const errors = [];
  for (const key of Object.keys(body)) {
    if (!['name', 'description', 'passengerCapacity', 'luggageCapacity', 'isActive', 'status', 'vehicleTypeId', 'imageUrl'].includes(key)) { errors.push(`${key} is not supported.`); }
  }
  if ('name' in body && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120)) {
    errors.push('name must contain 1 to 120 characters.');
  }
  if ('description' in body && (typeof body.description !== 'string' || body.description.length > 1000)) {
    errors.push('description must be a string of at most 1000 characters.');
  }
  if ('passengerCapacity' in body && body.passengerCapacity !== null &&
    (!Number.isInteger(body.passengerCapacity) || body.passengerCapacity < 1 || body.passengerCapacity > 100)) {
    errors.push('passengerCapacity must be null or an integer between 1 and 100.');
  }
  if (body.luggageCapacity != null && (!Number.isInteger(body.luggageCapacity) || body.luggageCapacity < 0 || body.luggageCapacity > 100)) {
    errors.push('luggageCapacity must be null or an integer between 0 and 100.');
  }
  if (body.status !== undefined && !['active', 'inactive'].includes(body.status)) { errors.push('status must be active or inactive.'); }
  if ('status' in body && 'isActive' in body) { errors.push('Send status or isActive, not both.'); }
  if (body.vehicleTypeId != null && (!Number.isInteger(body.vehicleTypeId) || body.vehicleTypeId < 1 || body.vehicleTypeId > 2147483647)) { errors.push('vehicleTypeId must be null or a positive integer.'); }
  if (body.imageUrl != null) {
    try { const url = new URL(body.imageUrl); if (typeof body.imageUrl !== 'string' || !['https:', 'http:'].includes(url.protocol) || body.imageUrl.length > 2048) { throw new Error('Invalid URL'); } }
    catch { errors.push('imageUrl must be null or an HTTP(S) URL of at most 2048 characters.'); }
  }
  if ('isActive' in body && typeof body.isActive !== 'boolean') { errors.push('isActive must be boolean.'); }
  return errors;
}

export function validateService(body, creating = false) {
  if (!isObject(body) || !Object.keys(body).length) { return ['A nonempty JSON object is required.']; }
  const errors = [];
  const allowed = creating ? ['code', 'name', 'unit', 'sortOrder', 'status'] : ['name', 'sortOrder', 'status'];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) { errors.push(`${key} is not supported.`); }
  }
  if (body.status !== undefined && !['active', 'inactive'].includes(body.status)) { errors.push('status must be active or inactive.'); }
  if (creating && (typeof body.code !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(body.code))) {
    errors.push('code must be 1 to 64 lowercase letters, digits or underscores, starting with a letter.');
  }
  if ((creating || 'name' in body) && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120)) {
    errors.push('name must contain 1 to 120 characters.');
  }
  if (creating && !['trip', 'hour'].includes(body.unit)) { errors.push('unit must be trip or hour.'); }
  if ('sortOrder' in body && (!Number.isInteger(body.sortOrder) || body.sortOrder < 0 || body.sortOrder > 100000)) {
    errors.push('sortOrder must be an integer between 0 and 100000.');
  }
  return errors;
}

export function validatePrice(body, service) {
  if (!isObject(body)) { return ['A JSON object is required.']; }
  const errors = [];
  for (const key of Object.keys(body)) {
    if (!['amount', 'threeHourAmount', 'eightHourAmount', 'isFrom', 'minimumHours', 'currency', 'validFrom', 'validTo', 'status'].includes(key)) { errors.push(`${key} is not supported.`); }
  }
  if (body.currency !== undefined && (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency))) { errors.push('currency must be a three-letter uppercase code.'); }
  if (body.status !== undefined && !['active', 'inactive'].includes(body.status)) { errors.push('status must be active or inactive.'); }
  for (const key of ['validFrom', 'validTo']) {
    if (body[key] != null && (typeof body[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body[key]) || !Number.isFinite(Date.parse(body[key])))) { errors.push(key + ' must be an ISO timestamp with timezone or null.'); }
  }
  if (body.validTo != null && Date.parse(body.validTo) <= (body.validFrom == null ? Date.now() : Date.parse(body.validFrom))) { errors.push('validTo must be later than validFrom.'); }
  if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount < 0 || body.amount > 1000000 ||
    Math.abs(body.amount * 100 - Math.round(body.amount * 100)) > 0.000001) {
    errors.push('amount must be between 0 and 1000000 with at most two decimal places.');
  }
  if (body.threeHourAmount != null && (service.unit !== 'hour' || typeof body.threeHourAmount !== 'number' || !Number.isFinite(body.threeHourAmount) || body.threeHourAmount < 0 || body.threeHourAmount > 1000000 || Math.abs(body.threeHourAmount * 100 - Math.round(body.threeHourAmount * 100)) > 0.000001)) { errors.push('threeHourAmount requires an hourly service and a price between 0 and 1000000 with at most two decimal places.'); }
  if (body.eightHourAmount != null && (service.unit !== 'hour' || typeof body.eightHourAmount !== 'number' || !Number.isFinite(body.eightHourAmount) || body.eightHourAmount < 0 || body.eightHourAmount > 1000000 || Math.abs(body.eightHourAmount * 100 - Math.round(body.eightHourAmount * 100)) > 0.000001)) { errors.push('eightHourAmount requires an hourly service and a price between 0 and 1000000 with at most two decimal places.'); }
  if (body.isFrom !== undefined && typeof body.isFrom !== 'boolean') { errors.push('isFrom must be boolean.'); }
  if (body.minimumHours != null && (service.unit !== 'hour' || !Number.isInteger(body.minimumHours) || body.minimumHours < 1 || body.minimumHours > 24)) {
    errors.push('minimumHours requires an hourly service and must be an integer between 1 and 24.');
  }
  return errors;
}
