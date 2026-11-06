ALTER TABLE vehicles ADD COLUMN recommendation_priority INTEGER NOT NULL DEFAULT 100 CHECK (recommendation_priority >= 0);
ALTER TABLE vehicles ADD COLUMN passenger_capacity_with_luggage INTEGER CHECK (passenger_capacity_with_luggage >= 0);
ALTER TABLE vehicles ADD COLUMN wheelchair_capacity INTEGER NOT NULL DEFAULT 0 CHECK (wheelchair_capacity >= 0);

-- Fleet limits and preference order supplied by the operator.
WITH policy(name, passengers, bags, with_bags, wheelchair_users, priority) AS (VALUES
  ('Mercedes E Class', 3, 3, 3, 0, 10),
  ('Mercedes S Class', 3, 3, 3, 0, 10),
  ('Mercedes V-Class (New)', 7, 7, 7, 0, 20),
  ('7 Seater Maxi Cab Wheelchair', 3, NULL::integer, 3, 1, 10),
  ('9 Seater Maxi Cab Wheelchair', 5, NULL::integer, 5, 1, 20),
  ('Toyota Hiace 13 seater Minibus', 13, 9, 9, 0, 30),
  ('VIP / Executive Minibus', 13, 9, 9, 0, 30),
  ('19 Seater Coaches', 19, 0, 0, 0, 40),
  ('23 Seater Coaches', 23, 0, 0, 0, 40),
  ('40 Seater Coaches', 40, 40, 30, 0, 50)
)
UPDATE vehicles v SET passenger_capacity = p.passengers,
  luggage_capacity = p.bags, passenger_capacity_with_luggage = p.with_bags,
  wheelchair_capacity = p.wheelchair_users, recommendation_priority = p.priority
FROM policy p WHERE v.name = p.name;
