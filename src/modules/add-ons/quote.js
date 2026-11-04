const fail = (code, message) => { throw Object.assign(new Error(message), { code, details: [message] }); };

export function calculateQuote(input, catalog) {
  if (!catalog) { fail('NOT_FOUND', 'Active vehicle/service price not found.'); }
  if (catalog.is_from) { fail('QUOTE_UNAVAILABLE', 'A starting price requires a confirmed fare before quoting.'); }
  let units = 1;
  if (catalog.unit === 'hour') {
    if (!input.hours || input.hours < (catalog.minimum_hours ?? 1)) { fail('INVALID_INPUT', `hours must meet the minimum of ${catalog.minimum_hours ?? 1}.`); }
    units = input.hours;
  } else if (input.hours !== undefined) { fail('INVALID_INPUT', 'hours is supported only for hourly services.'); }
  const vehicleMinor = Math.round(Number(catalog.price) * 100) * units;
  let addOnMinor = 0;
  const selections = input.add_ons.map(selection => {
    const item = catalog.add_ons.find(addOn => addOn.id === selection.add_on_id);
    if (!item) { fail('NOT_FOUND', 'Selected add-on is missing or inactive.'); }
    if (item.currency !== catalog.currency) { fail('INVALID_INPUT', 'All selected prices must use the same currency.'); }
    if (item.pricing_type === 'FIXED' && selection.quantity !== 1) { fail('INVALID_INPUT', 'Fixed add-ons require quantity 1.'); }
    const unitMinor = Math.round(Number(item.price) * 100);
    const amountMinor = unitMinor * selection.quantity;
    addOnMinor += amountMinor;
    return { id: item.id, code: item.code, name: item.name, pricing_type: item.pricing_type,
      quantity: selection.quantity, unit_price: unitMinor / 100, amount: amountMinor / 100 };
  });
  return { vehicle: { id: input.vehicle_id, name: catalog.vehicle_name, price: Number(catalog.price) },
    service: { id: input.service_id, name: catalog.service_name, unit: catalog.unit },
    catalog_id: catalog.catalog_id, ...(catalog.unit === 'hour' ? { hours: units } : {}),
    add_ons: selections, vehicle_amount: vehicleMinor / 100, add_on_amount: addOnMinor / 100,
    total_amount: (vehicleMinor + addOnMinor) / 100, currency: catalog.currency };
}

export function applyDistancePricing(input, quote, rules, distanceMeters) {
  if (!Number.isSafeInteger(distanceMeters) || distanceMeters < 0) { fail('DISTANCE_UNAVAILABLE', 'Driving distance is invalid.'); }
  // Compare the exact meter distance; do not round kilometers before selecting a bracket.
  const matches = (rules ?? []).filter(rule => {
    const min = Math.round(Number(rule.min_distance_km) * 1000);
    const max = rule.max_distance_km === null ? null : Math.round(Number(rule.max_distance_km) * 1000);
    return (rule.min_inclusive ? distanceMeters >= min : distanceMeters > min) &&
      (max === null || (rule.max_inclusive ? distanceMeters <= max : distanceMeters < max));
  });
  if (matches.length !== 1) { fail('DISTANCE_PRICING_UNAVAILABLE', 'Distance pricing is not configured for this route. Please contact support.'); }
  const rule = matches[0];
  const route = { pickup: input.pickup.address.trim(), drop: input.drop.address.trim(), distance_km: distanceMeters / 1000 };
  if (rule.is_contact_support) {
    return { success: true, quote_status: 'CONTACT_SUPPORT', route,
      distance: { value: distanceMeters / 1000, unit: 'km' },
      message: 'This route requires a customized quotation. Please contact our support team via WhatsApp.',
      whatsapp: { enabled: true } };
  }
  if (rule.currency !== quote.currency) { fail('INVALID_INPUT', 'Distance pricing must use the same currency as the vehicle fare.'); }
  const distanceMinor = Math.round(Number(rule.surcharge) * 100);
  const totalMinor = Math.round(quote.vehicle_amount * 100) + Math.round(quote.add_on_amount * 100) + distanceMinor;
  const label = `${rule.min_inclusive ? '[' : '('}${Number(rule.min_distance_km)},${rule.max_distance_km === null ? 'unbounded' : Number(rule.max_distance_km)}${rule.max_inclusive ? ']' : ')'} km`;
  return { success: true, quote_status: 'AVAILABLE', quote: { ...quote, route,
    distance_charge: { rule_id: rule.id, rule: label, amount: distanceMinor / 100 },
    distance_amount: distanceMinor / 100, total_amount: totalMinor / 100 } };
}
