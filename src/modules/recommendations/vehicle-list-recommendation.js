export function parseRequirements(query) {
  const details = [];
  for (const key of Object.keys(query)) {
    if (!['persons', 'luggage', 'wheelchair'].includes(key)) { details.push(`${key} is not supported.`); }
  }
  if (!Object.hasOwn(query, 'persons') && !Object.hasOwn(query, 'luggage') && !Object.hasOwn(query, 'wheelchair')) {
    return { requirements: null, details };
  }
  for (const [key, minimum] of [['persons', query.wheelchair === 'true' ? 0 : 1], ['luggage', 0]]) {
    if (typeof query[key] !== 'string' || !/^\d{1,3}$/.test(query[key]) || Number(query[key]) < minimum || Number(query[key]) > 100) {
      details.push(`${key} must be an integer between ${minimum} and 100.`);
    }
  }
  if (query.wheelchair !== undefined && !['true', 'false'].includes(query.wheelchair)) {
    details.push('wheelchair must be true or false.');
  }
  return { requirements: { persons: Number(query.persons), luggage: Number(query.luggage),
    ...(query.wheelchair !== undefined ? { wheelchair: query.wheelchair === 'true' } : {}) }, details };
}

export function annotateVehicles(vehicles, requirements) {
  const passengers = vehicle => requirements.luggage > 0 && Number.isInteger(vehicle.passengerCapacityWithLuggage)
    ? Math.min(vehicle.passengerCapacity, vehicle.passengerCapacityWithLuggage) : vehicle.passengerCapacity;
  const suitable = vehicle => vehicle.status !== 'inactive' && vehicle.isActive !== false &&
    Boolean((vehicle.wheelchairCapacity ?? 0) > 0) === Boolean(requirements.wheelchair) &&
    Number.isInteger(vehicle.passengerCapacity) && passengers(vehicle) >= requirements.persons &&
    (requirements.luggage === 0 || (Number.isInteger(vehicle.luggageCapacity) && vehicle.luggageCapacity >= requirements.luggage)) &&
    Object.keys(vehicle.prices ?? {}).length > 0;
  const unused = vehicle => passengers(vehicle) - requirements.persons +
    (vehicle.luggageCapacity ?? 0) - requirements.luggage;
  const candidates = requirements ? vehicles.filter(suitable).sort((a, b) =>
    (a.recommendationPriority ?? 100) - (b.recommendationPriority ?? 100) ||
    unused(a) - unused(b) || a.passengerCapacity - b.passengerCapacity ||
    (a.luggageCapacity ?? 0) - (b.luggageCapacity ?? 0) || a.id - b.id) : [];
  const best = candidates[0];
  return { data: vehicles.map(vehicle => ({ ...vehicle, recommendation: best?.id === vehicle.id })) };
}
