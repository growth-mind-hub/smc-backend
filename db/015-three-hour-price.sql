-- Full three-hour package price, separate from the per-hour rate.
ALTER TABLE vehicle_service_prices
  ADD COLUMN three_hour_amount NUMERIC(12,2)
  CHECK (three_hour_amount BETWEEN 0 AND 1000000);

CREATE FUNCTION check_three_hour_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.three_hour_amount IS NOT NULL AND
    (SELECT pricing_unit FROM services WHERE id = NEW.service_id) <> 'hour' THEN
    RAISE EXCEPTION 'three_hour_amount requires an hourly service' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vehicle_service_prices_three_hour
  BEFORE INSERT OR UPDATE ON vehicle_service_prices
  FOR EACH ROW EXECUTE FUNCTION check_three_hour_price();

UPDATE vehicle_service_prices p
SET three_hour_amount = p.price * 3
FROM services s
WHERE s.id = p.service_id AND s.pricing_unit = 'hour'
  AND p.price * 3 <= 1000000;
