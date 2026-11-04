CREATE TABLE add_ons (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,49}$'),
  name VARCHAR(150) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  pricing_type TEXT NOT NULL CHECK (pricing_type IN ('FIXED', 'PER_STOP')),
  price NUMERIC(12,2) NOT NULL CHECK (price BETWEEN 0 AND 1000000),
  currency TEXT NOT NULL DEFAULT 'SGD' CHECK (currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER add_ons_updated_at BEFORE UPDATE ON add_ons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO add_ons (code, name, pricing_type, price) VALUES
  ('NIGHT_TRAVEL', 'Travelling between 23:30–06:30', 'FIXED', 10),
  ('MEET_GREET', 'Arrival Meet & Greet', 'FIXED', 20),
  ('BABY_SEAT', 'Baby Seat', 'FIXED', 20),
  ('STOP_WITHIN_2KM', 'Additional Stop within 2 km', 'PER_STOP', 10),
  ('STOP_OVER_2KM', 'Additional Stop more than 2 km', 'PER_STOP', 20);
