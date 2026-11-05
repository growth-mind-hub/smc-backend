export function applyCardSurcharge(quote) {
  const subtotalMinor = Math.round(quote.total_amount * 100);
  const surchargeMinor = Math.round(subtotalMinor / 10);
  return { ...quote, subtotal_amount: subtotalMinor / 100,
    card_surcharge_percent: 10, card_surcharge_amount: surchargeMinor / 100,
    total_amount: (subtotalMinor + surchargeMinor) / 100 };
}
