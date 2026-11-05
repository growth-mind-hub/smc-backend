ALTER TABLE bookings ADD COLUMN card_surcharge_minor BIGINT NOT NULL DEFAULT 0 CHECK (card_surcharge_minor >= 0);
ALTER TABLE bookings DROP CONSTRAINT bookings_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_total_breakdown CHECK (
  total_amount_minor = vehicle_amount_minor + distance_amount_minor + add_on_amount_minor + card_surcharge_minor
);
