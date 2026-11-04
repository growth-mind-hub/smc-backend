CREATE TABLE vehicle_types (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description TEXT NOT NULL DEFAULT ''
);
ALTER TABLE vehicles ADD COLUMN vehicle_type_id INTEGER REFERENCES vehicle_types(id);
ALTER TABLE vehicles ADD COLUMN image_url TEXT;
ALTER TABLE vehicles ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'));
ALTER TABLE vehicles ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE vehicles SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END;
ALTER TABLE vehicles DROP COLUMN is_active;

DROP TRIGGER vehicle_prices_service_unit ON vehicle_prices;
DROP FUNCTION check_price_service_unit();
ALTER TABLE vehicle_prices DROP CONSTRAINT vehicle_prices_service_fkey;
ALTER TABLE services ADD COLUMN id INTEGER GENERATED ALWAYS AS IDENTITY;
ALTER TABLE services DROP CONSTRAINT services_pkey;
ALTER TABLE services ADD PRIMARY KEY (id);
ALTER TABLE services ADD UNIQUE (code);
ALTER TABLE services RENAME COLUMN code TO service_code;
ALTER TABLE services RENAME COLUMN name TO service_name;
ALTER TABLE services RENAME COLUMN unit TO pricing_unit;
ALTER TABLE services ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'));

ALTER TABLE vehicle_prices ADD COLUMN service_id INTEGER REFERENCES services(id);
UPDATE vehicle_prices p SET service_id = s.id FROM services s WHERE s.service_code = p.service;
ALTER TABLE vehicle_prices ALTER COLUMN service_id SET NOT NULL;
ALTER TABLE vehicle_prices DROP CONSTRAINT vehicle_prices_pkey;
ALTER TABLE vehicle_prices DROP COLUMN service;
ALTER TABLE vehicle_prices ADD UNIQUE (vehicle_id, service_id);
ALTER TABLE vehicle_prices ADD PRIMARY KEY (id);
ALTER TABLE vehicle_prices ADD COLUMN price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price BETWEEN 0 AND 1000000);
UPDATE vehicle_prices SET price = amount_minor::numeric / 100;
ALTER TABLE vehicle_prices DROP COLUMN amount_minor;
ALTER TABLE vehicle_prices ADD COLUMN currency TEXT;
UPDATE vehicle_prices p SET currency = v.currency FROM vehicles v WHERE v.id = p.vehicle_id;
ALTER TABLE vehicle_prices ALTER COLUMN currency SET NOT NULL;
ALTER TABLE vehicle_prices ADD CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE vehicles DROP COLUMN currency;
ALTER TABLE vehicle_prices ADD COLUMN valid_from TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE vehicle_prices ADD COLUMN valid_to TIMESTAMPTZ;
ALTER TABLE vehicle_prices ADD CHECK (valid_to IS NULL OR valid_to > valid_from);
ALTER TABLE vehicle_prices ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'));
ALTER TABLE vehicle_prices ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE vehicle_prices ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE vehicle_prices RENAME TO vehicle_service_prices;

CREATE FUNCTION check_price_service_unit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.minimum_hours IS NOT NULL AND
    (SELECT pricing_unit FROM services WHERE id = NEW.service_id) <> 'hour' THEN
    RAISE EXCEPTION 'minimum_hours requires an hourly service' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vehicle_service_prices_unit BEFORE INSERT OR UPDATE ON vehicle_service_prices
  FOR EACH ROW EXECUTE FUNCTION check_price_service_unit();

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON vehicles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER prices_updated_at BEFORE UPDATE ON vehicle_service_prices FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX vehicles_type_index ON vehicles(vehicle_type_id);
CREATE INDEX prices_service_index ON vehicle_service_prices(service_id);
