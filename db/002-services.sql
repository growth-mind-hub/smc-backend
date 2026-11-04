CREATE TABLE services (
  code TEXT PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('trip', 'hour')),
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO services (code, name, unit, sort_order) VALUES
  ('arrival', 'Arrival', 'trip', 1),
  ('departure_transfer', 'Departure / Transfer', 'trip', 2),
  ('hourly', 'Hourly Disposal', 'hour', 3);

ALTER TABLE vehicle_prices DROP CONSTRAINT vehicle_prices_service_check;
ALTER TABLE vehicle_prices ADD CONSTRAINT vehicle_prices_service_fkey
  FOREIGN KEY (service) REFERENCES services(code);
-- The minimum-hours rule uses the service billing unit rather than its code.
ALTER TABLE vehicle_prices DROP CONSTRAINT vehicle_prices_check;
CREATE FUNCTION check_price_service_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.minimum_hours IS NOT NULL AND
    (SELECT unit FROM services WHERE code = NEW.service) <> 'hour' THEN
    RAISE EXCEPTION 'minimum_hours requires an hourly service' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vehicle_prices_service_unit BEFORE INSERT OR UPDATE ON vehicle_prices
  FOR EACH ROW EXECUTE FUNCTION check_price_service_unit();
