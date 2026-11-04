-- Passenger and bag capacities supplied for the fleet.
WITH capacities(name, passengers, bags) AS (VALUES
  ('Mercedes E Class', 3, 2),
  ('Mercedes S Class', 3, 2),
  ('Toyota Alphard / Vellfire', 6, 6),
  ('Mercedes Vito/Viano', 7, 6),
  ('Mercedes V-Class (New)', 7, 6),
  ('Toyota Hiace 13 seater Minibus', 13, 8),
  ('VIP / Executive Minibus', 13, 9),
  ('23 Seater Coaches', 23, 23)
)
UPDATE vehicles v
SET passenger_capacity = c.passengers, luggage_capacity = c.bags
FROM capacities c
WHERE v.name = c.name;
