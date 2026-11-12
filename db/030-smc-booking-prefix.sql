CREATE OR REPLACE FUNCTION next_booking_number() RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  serial_number TEXT := nextval('booking_number_sequence')::text;
BEGIN
  RETURN 'SMC' || to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore', 'YYYYMMDD') ||
    lpad(serial_number, greatest(3, char_length(serial_number)), '0');
END;
$$;
