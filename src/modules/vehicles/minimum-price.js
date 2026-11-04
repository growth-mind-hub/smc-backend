export function minimumPrice(vehicle) {
  const candidates = [];
  for (const [service, price] of Object.entries(vehicle.prices ?? {})) {
    const common = { currency: price.currency, service, serviceName: price.serviceName, catalogId: price.catalogId, isFrom: price.isFrom };
    if (Number.isFinite(price.amount)) {
      candidates.push({ ...common, amount: price.amount, amountMinor: Math.round(price.amount * 100), unit: price.unit, minimumHours: price.minimumHours ?? null, hours: null });
    }
    if (price.unit === 'hour') {
      for (const [key, hours] of [['threeHourAmount', 3], ['eightHourAmount', 8]]) {
        if (Number.isFinite(price[key])) {
          candidates.push({ ...common, amount: price[key], amountMinor: Math.round(price[key] * 100), unit: 'package', minimumHours: null, hours });
        }
      }
    }
  }
  // Different currencies cannot be compared without an exchange rate.
  if (new Set(candidates.map(p => p.currency)).size > 1) { return null; }
  return candidates.sort((a, b) => a.amount - b.amount || a.service.localeCompare(b.service))[0] ?? null;
}
