-- Initial configured luggage limits from the supplied recommendation examples.
-- Preserve limits already set by an administrator. Confirm actual fleet layouts
-- and suitcase sizes before treating these configuration values as guarantees.
UPDATE vehicles v SET luggage_capacity = limits.bags
FROM (VALUES
  ('Mercedes E Class', 2),
  ('Mercedes S Class', 3),
  ('Toyota Alphard / Vellfire', 6),
  ('Mercedes Vito/Viano', 7),
  ('Mercedes V-Class (New)', 7),
  ('Toyota Hiace 13 seater Minibus', 8),
  ('23 Seater Coaches', 12),
  ('40 Seater Coaches', 25)
) AS limits(name, bags)
WHERE v.name = limits.name AND v.luggage_capacity IS NULL;
-- VIP and wheelchair configurations require additional confirmed capacity data.
