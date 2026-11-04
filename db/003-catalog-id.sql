-- Stable identifier for a vehicle/service price selection, including existing rows.
ALTER TABLE vehicle_prices ADD COLUMN id INTEGER GENERATED ALWAYS AS IDENTITY;
ALTER TABLE vehicle_prices ADD CONSTRAINT vehicle_prices_id_unique UNIQUE (id);
