-- Exact SGD prices supplied for the booking selector.
-- price remains the per-hour rate for hourly services.
WITH rates(name, arrival, departure, three_hour, eight_hour) AS (VALUES
  ('Toyota Alphard / Vellfire', 75, 65, 180, 480),
  ('Mercedes Vito/Viano', 80, 70, 195, 520),
  ('7 Seater Maxi Cab Wheelchair', 80, 75, 210, 560),
  ('9 Seater Maxi Cab Wheelchair', 90, 85, 240, 640),
  ('9 Seater Minibus', 75, 65, 180, 480),
  ('Toyota Hiace 13 seater Minibus', 85, 75, 195, 520),
  ('VIP / Executive Minibus', 95, 90, 255, 680)
)
INSERT INTO vehicle_service_prices
  (vehicle_id, service_id, price, currency, is_from, minimum_hours, three_hour_amount, eight_hour_amount)
SELECT v.id, s.id,
  CASE s.service_code WHEN 'arrival' THEN r.arrival
    WHEN 'departure_transfer' THEN r.departure ELSE r.three_hour / 3.0 END,
  'SGD', FALSE,
  CASE WHEN s.service_code = 'hourly' THEN 3 END,
  CASE WHEN s.service_code = 'hourly' THEN r.three_hour END,
  CASE WHEN s.service_code = 'hourly' THEN r.eight_hour END
FROM rates r JOIN vehicles v ON v.name = r.name
CROSS JOIN services s
WHERE s.service_code IN ('arrival', 'departure_transfer', 'hourly')
ON CONFLICT (vehicle_id, service_id) DO UPDATE SET
  price = EXCLUDED.price, currency = EXCLUDED.currency,
  is_from = EXCLUDED.is_from, minimum_hours = EXCLUDED.minimum_hours,
  three_hour_amount = EXCLUDED.three_hour_amount,
  eight_hour_amount = EXCLUDED.eight_hour_amount;
