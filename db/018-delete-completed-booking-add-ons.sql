-- Keep booking snapshots when their catalog add-on is deleted.
ALTER TABLE booking_add_ons ALTER COLUMN add_on_id DROP NOT NULL;
ALTER TABLE booking_add_ons DROP CONSTRAINT booking_add_ons_add_on_id_fkey;
ALTER TABLE booking_add_ons ADD CONSTRAINT booking_add_ons_add_on_id_fkey
  FOREIGN KEY (add_on_id) REFERENCES add_ons(id) ON DELETE SET NULL;

CREATE FUNCTION check_add_on_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize deletion with changes to the linked bookings' operational status.
  PERFORM b.id FROM bookings b
    JOIN booking_add_ons ba ON ba.booking_id = b.id
    WHERE ba.add_on_id = OLD.id ORDER BY b.id FOR UPDATE OF b;
  IF EXISTS (
    SELECT 1 FROM booking_add_ons ba JOIN bookings b ON b.id = ba.booking_id
    WHERE ba.add_on_id = OLD.id AND b.booking_status <> 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'Add-on is used by an uncompleted booking' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER add_ons_before_delete BEFORE DELETE ON add_ons
  FOR EACH ROW EXECUTE FUNCTION check_add_on_deletion();
