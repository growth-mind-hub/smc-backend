CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT '',
  passenger_capacity INTEGER CHECK (passenger_capacity BETWEEN 1 AND 100),
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_name_unique ON vehicles (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS vehicle_prices (
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service TEXT NOT NULL CHECK (service IN ('arrival', 'departure_transfer', 'hourly')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 0 AND 100000000),
  is_from BOOLEAN NOT NULL DEFAULT FALSE,
  minimum_hours INTEGER CHECK (minimum_hours BETWEEN 1 AND 24),
  PRIMARY KEY (vehicle_id, service),
  CHECK (service = 'hourly' OR minimum_hours IS NULL)
);
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
