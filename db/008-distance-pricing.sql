CREATE TABLE distance_pricing_rules (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  min_distance_km NUMERIC(10,3) NOT NULL CHECK (min_distance_km >= 0),
  max_distance_km NUMERIC(10,3),
  min_inclusive BOOLEAN NOT NULL DEFAULT TRUE,
  max_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
  surcharge NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (surcharge BETWEEN 0 AND 1000000),
  currency TEXT NOT NULL DEFAULT 'SGD' CHECK (currency ~ '^[A-Z]{3}$'),
  is_contact_support BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  distance_range NUMRANGE GENERATED ALWAYS AS
    (numrange(min_distance_km, max_distance_km,
      (CASE WHEN min_inclusive THEN '[' ELSE '(' END) ||
      (CASE WHEN max_inclusive THEN ']' ELSE ')' END))) STORED,
  CHECK (max_distance_km IS NULL OR max_distance_km > min_distance_km),
  CHECK (NOT is_contact_support OR surcharge = 0),
  EXCLUDE USING gist (distance_range WITH &&) WHERE (status = 'ACTIVE')
);
CREATE TRIGGER distance_rules_updated_at BEFORE UPDATE ON distance_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO distance_pricing_rules
  (min_distance_km, max_distance_km, min_inclusive, max_inclusive, surcharge, is_contact_support)
VALUES
  (0, 28, TRUE, FALSE, 0, FALSE),
  (28, 30, TRUE, FALSE, 5, FALSE),
  (30, 32, TRUE, FALSE, 10, FALSE),
  (32, 35, TRUE, TRUE, 15, FALSE),
  (35, NULL, FALSE, FALSE, 0, TRUE);
