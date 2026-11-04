-- Default missing eight-hour packages to eight times the hourly rate.
-- Preserve all existing package prices.
UPDATE vehicle_service_prices p
SET eight_hour_amount = p.price * 8
FROM services s
WHERE s.id = p.service_id AND s.pricing_unit = 'hour'
  AND p.eight_hour_amount IS NULL;
