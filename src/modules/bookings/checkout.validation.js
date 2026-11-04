import { validateQuote } from '../add-ons/add-on.validation.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function validateCheckout(body, idempotencyKey) {
  if (!object(body)) { return ['A JSON object is required.']; }
  const { customer, payment_method: paymentMethod, ...quoteInput } = body;
  const errors = validateQuote(quoteInput);
  if (paymentMethod !== 'STRIPE') { errors.push('payment_method must be STRIPE.'); }
  if (!object(customer)) { errors.push('customer must contain name, email and phone.'); }
  else {
    for (const key of Object.keys(customer)) { if (!['name', 'email', 'phone'].includes(key)) { errors.push(`customer.${key} is not supported.`); } }
    if (typeof customer.name !== 'string' || !customer.name.trim() || customer.name.trim().length > 150) { errors.push('customer.name must contain 1 to 150 characters.'); }
    if (typeof customer.email !== 'string' || customer.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) { errors.push('customer.email must be a valid email address of at most 254 characters.'); }
    if (typeof customer.phone !== 'string' || !/^\+[1-9]\d{6,14}$/.test(customer.phone)) { errors.push('customer.phone must use international format, for example +6591234567.'); }
  }
  if (idempotencyKey !== undefined && !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) { errors.push('Idempotency-Key must contain 8 to 128 letters, digits, underscores or hyphens.'); }
  return errors;
}

export function normalizeCheckout(body) {
  return { customer: { name: body.customer.name.trim(), email: body.customer.email.toLowerCase(), phone: body.customer.phone },
    vehicle_id: body.vehicle_id, service_id: body.service_id,
    pickup: { address: body.pickup.address.trim() }, drop: { address: body.drop.address.trim() },
    add_ons: body.add_ons.map(item => ({ add_on_id: item.add_on_id, quantity: item.quantity })).sort((a, b) => a.add_on_id - b.add_on_id),
    ...(body.hours !== undefined ? { hours: body.hours } : {}), payment_method: 'STRIPE' };
}
