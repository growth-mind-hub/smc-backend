export function parseRequirements(query) {
  const details = [];
  for (const key of Object.keys(query)) {
    if (!['persons', 'luggage'].includes(key)) { details.push(`${key} is not supported.`); }
  }
  if (!Object.hasOwn(query, 'persons') && !Object.hasOwn(query, 'luggage')) {
    return { requirements: null, details };
  }
  for (const [key, minimum] of [['persons', 1], ['luggage', 0]]) {
    if (typeof query[key] !== 'string' || !/^\d{1,3}$/.test(query[key]) || Number(query[key]) < minimum || Number(query[key]) > 100) {
      details.push(`${key} must be an integer between ${minimum} and 100.`);
    }
  }
  return { requirements: { persons: Number(query.persons), luggage: Number(query.luggage) }, details };
}

export function annotateVehicles(vehicles, requirements) {
  const suitable = vehicle => Number.isInteger(vehicle.passengerCapacity) && Number.isInteger(vehicle.luggageCapacity) &&
    vehicle.passengerCapacity >= requirements.persons && vehicle.luggageCapacity >= requirements.luggage &&
    Object.keys(vehicle.prices ?? {}).length > 0;
  const unused = vehicle => vehicle.passengerCapacity - requirements.persons + vehicle.luggageCapacity - requirements.luggage;
  const candidates = requirements ? vehicles.filter(suitable).sort((a, b) =>
    unused(a) - unused(b) || a.passengerCapacity - b.passengerCapacity || a.luggageCapacity - b.luggageCapacity || a.id - b.id) : [];
  const best = candidates[0];
  return { data: vehicles.map(vehicle => ({ ...vehicle, recommendation: best?.id === vehicle.id })) };
}
