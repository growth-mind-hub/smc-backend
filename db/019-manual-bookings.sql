ALTER TABLE bookings DROP CONSTRAINT bookings_payment_method_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_method_check
  CHECK (payment_method IN ('STRIPE', 'MANUAL'));
