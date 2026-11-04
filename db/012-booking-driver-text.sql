ALTER TABLE bookings
  ADD COLUMN driver_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN driver_phone TEXT NOT NULL DEFAULT '';

UPDATE bookings b SET
  driver_name = COALESCE((SELECT string_agg(driver->>'name', ', ' ORDER BY position)
    FROM jsonb_array_elements(b.assigned_drivers) WITH ORDINALITY AS items(driver, position)), ''),
  driver_phone = COALESCE((SELECT string_agg(driver->>'phone', ', ' ORDER BY position)
    FROM jsonb_array_elements(b.assigned_drivers) WITH ORDINALITY AS items(driver, position)), '');

ALTER TABLE bookings DROP COLUMN assigned_drivers;
