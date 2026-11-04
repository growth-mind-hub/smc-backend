-- Prices supplied for the booking selector. Hourly price is per hour;
-- eight_hour_amount is the complete eight-hour package price.
UPDATE vehicles SET name = '7 Seater Maxi Cab Wheelchair', passenger_capacity = 7
WHERE name = 'Wheelchair-Accessible Maxi Cab';

INSERT INTO vehicles (name, description, passenger_capacity, status)
VALUES ('9 Seater Maxi Cab Wheelchair', 'Wheelchair accessible', 9, 'active'),
       ('9 Seater Minibus', '', 9, 'active')
ON CONFLICT DO NOTHING;

WITH rates(name, arrival, departure, hourly, eight_hour) AS (VALUES
  ('Toyota Alphard / Vellfire', 75, 65, 60, 480),
  ('Mercedes Vito/Viano', 80, 70, 65, 520),
  ('7 Seater Maxi Cab Wheelchair', 80, 75, 70, 560),
  ('9 Seater Maxi Cab Wheelchair', 90, 85, 80, 640),
  ('9 Seater Minibus', 75, 65, 60, 480),
  ('Toyota Hiace 13 seater Minibus', 85, 75, 65, 520),
  ('VIP / Executive Minibus', 95, 90, 85, 680)
)
INSERT INTO vehicle_service_prices
  (vehicle_id, service_id, price, currency, is_from, minimum_hours, eight_hour_amount)
SELECT v.id, s.id,
  CASE s.service_code WHEN 'arrival' THEN r.arrival
    WHEN 'departure_transfer' THEN r.departure ELSE r.hourly END,
  'SGD', FALSE,
  CASE WHEN s.service_code = 'hourly' THEN 3 END,
  CASE WHEN s.service_code = 'hourly' THEN r.eight_hour END
FROM rates r JOIN vehicles v ON v.name = r.name
CROSS JOIN services s
WHERE s.service_code IN ('arrival', 'departure_transfer', 'hourly')
ON CONFLICT (vehicle_id, service_id) DO UPDATE SET
  price = EXCLUDED.price, currency = EXCLUDED.currency,
  is_from = EXCLUDED.is_from, minimum_hours = EXCLUDED.minimum_hours,
  eight_hour_amount = EXCLUDED.eight_hour_amount;
