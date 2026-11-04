CREATE SEQUENCE booking_number_sequence;
CREATE FUNCTION next_booking_number() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  serial_number TEXT := nextval('booking_number_sequence')::text;
BEGIN
  RETURN 'BK' || to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore', 'YYYYMMDD') ||
    lpad(serial_number, greatest(3, char_length(serial_number)), '0');
END;
$$;

CREATE TABLE bookings (
  id UUID PRIMARY KEY,
  booking_number TEXT UNIQUE NOT NULL DEFAULT next_booking_number(),
  idempotency_key TEXT UNIQUE NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  customer_name TEXT NOT NULL CHECK (char_length(btrim(customer_name)) BETWEEN 1 AND 150),
  customer_email TEXT NOT NULL CHECK (char_length(customer_email) BETWEEN 3 AND 254),
  customer_phone TEXT NOT NULL CHECK (customer_phone ~ '^\+[1-9][0-9]{6,14}$'),
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  catalog_id INTEGER NOT NULL REFERENCES vehicle_service_prices(id),
  pickup_address TEXT NOT NULL CHECK (char_length(btrim(pickup_address)) BETWEEN 1 AND 500),
  drop_address TEXT NOT NULL CHECK (char_length(btrim(drop_address)) BETWEEN 1 AND 500),
  distance_meters INTEGER NOT NULL CHECK (distance_meters >= 0),
  hours INTEGER CHECK (hours BETWEEN 1 AND 24),
  vehicle_amount_minor BIGINT NOT NULL CHECK (vehicle_amount_minor >= 0),
  distance_amount_minor BIGINT NOT NULL CHECK (distance_amount_minor >= 0),
  add_on_amount_minor BIGINT NOT NULL CHECK (add_on_amount_minor >= 0),
  total_amount_minor BIGINT NOT NULL CHECK (total_amount_minor BETWEEN 50 AND 99999999),
  currency TEXT NOT NULL CHECK (currency = 'SGD'),
  quote_snapshot JSONB NOT NULL CHECK (jsonb_typeof(quote_snapshot) = 'object'),
  payment_method TEXT NOT NULL DEFAULT 'STRIPE' CHECK (payment_method = 'STRIPE'),
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
    CHECK (status IN ('PENDING_PAYMENT', 'PAID', 'PAYMENT_FAILED', 'PAYMENT_EXPIRED')),
  stripe_session_id TEXT UNIQUE,
  stripe_checkout_url TEXT,
  stripe_livemode BOOLEAN,
  stripe_payment_intent_id TEXT,
  checkout_expires_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '1 hour',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (total_amount_minor = vehicle_amount_minor + distance_amount_minor + add_on_amount_minor)
);
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE booking_add_ons (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings(id),
  add_on_id INTEGER NOT NULL REFERENCES add_ons(id),
  add_on_code TEXT NOT NULL,
  add_on_name TEXT NOT NULL,
  pricing_type TEXT NOT NULL CHECK (pricing_type IN ('FIXED', 'PER_STOP')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor >= 0),
  total_price_minor BIGINT NOT NULL CHECK (total_price_minor = unit_price_minor * quantity),
  UNIQUE (booking_id, add_on_id),
  CHECK (pricing_type <> 'FIXED' OR quantity = 1)
);

CREATE TABLE stripe_webhook_events (
  id TEXT PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES bookings(id),
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
