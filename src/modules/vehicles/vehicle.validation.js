export function validateVehicle(body, serviceRows) {
  const services = serviceRows.map(s => s.code);
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {return ['A JSON object is required.'];}
  for (const key of Object.keys(body)) {if (!['name', 'description', 'passengerCapacity', 'luggageCapacity', 'isActive', 'status', 'vehicleTypeId', 'imageUrl', 'currency', 'prices'].includes(key)) {errors.push(`${key} is not supported.`);}}
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120) {errors.push('name must contain 1 to 120 characters.');}
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 1000)) {errors.push('description must be a string of at most 1000 characters.');}
  if (body.passengerCapacity != null && (!Number.isInteger(body.passengerCapacity) || body.passengerCapacity < 1 || body.passengerCapacity > 100)) {errors.push('passengerCapacity must be null or an integer between 1 and 100.');}
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
  if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) {errors.push('currency must be a three-letter uppercase currency code.');}
  if (!body.prices || typeof body.prices !== 'object' || Array.isArray(body.prices)) {return [...errors, 'prices must contain all configured services.'];}
  for (const key of Object.keys(body.prices)) {if (!services.includes(key)) {errors.push(`prices.${key} is not supported.`);}}
  for (const service of services) {
    const p = body.prices[service];
    if (!p || typeof p !== 'object' || Array.isArray(p)) { errors.push(`prices.${service} is required.`); continue; }
    for (const key of Object.keys(p)) {if (!['amount', 'threeHourAmount', 'eightHourAmount', 'isFrom', 'minimumHours'].includes(key)) {errors.push(`prices.${service}.${key} is not supported.`);}}
    if (typeof p.amount !== 'number' || !Number.isFinite(p.amount) || p.amount < 0 || p.amount > 1000000 || Math.abs(p.amount * 100 - Math.round(p.amount * 100)) > 0.000001) {errors.push(`prices.${service}.amount must be between 0 and 1000000 with at most two decimal places.`);}
  if (p.threeHourAmount != null && (serviceRows.find(s => s.code === service).unit !== 'hour' || typeof p.threeHourAmount !== 'number' || !Number.isFinite(p.threeHourAmount) || p.threeHourAmount < 0 || p.threeHourAmount > 1000000 || Math.abs(p.threeHourAmount * 100 - Math.round(p.threeHourAmount * 100)) > 0.000001)) { errors.push('threeHourAmount requires an hourly service and a price between 0 and 1000000 with at most two decimal places.'); }
  if (p.eightHourAmount != null && (serviceRows.find(s => s.code === service).unit !== 'hour' || typeof p.eightHourAmount !== 'number' || !Number.isFinite(p.eightHourAmount) || p.eightHourAmount < 0 || p.eightHourAmount > 1000000 || Math.abs(p.eightHourAmount * 100 - Math.round(p.eightHourAmount * 100)) > 0.000001)) { errors.push('eightHourAmount requires an hourly service and a price between 0 and 1000000 with at most two decimal places.'); }
    if (p.isFrom !== undefined && typeof p.isFrom !== 'boolean') {errors.push(`prices.${service}.isFrom must be boolean.`);}
    if (p.minimumHours != null && (serviceRows.find(s => s.code === service).unit !== 'hour' || !Number.isInteger(p.minimumHours) || p.minimumHours < 1 || p.minimumHours > 24)) {errors.push(`prices.${service}.minimumHours is only valid for hourly and must be an integer between 1 and 24.`);}
  }
  return errors;
}
