ALTER TABLE vehicle_service_prices
  ADD COLUMN eight_hour_amount NUMERIC(12,2)
  CHECK (eight_hour_amount BETWEEN 0 AND 1000000);

CREATE FUNCTION check_eight_hour_price() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.eight_hour_amount IS NOT NULL AND
    (SELECT pricing_unit FROM services WHERE id = NEW.service_id) <> 'hour' THEN
    RAISE EXCEPTION 'eight_hour_amount requires an hourly service' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER vehicle_service_prices_eight_hour
  BEFORE INSERT OR UPDATE ON vehicle_service_prices
  FOR EACH ROW EXECUTE FUNCTION check_eight_hour_price();
