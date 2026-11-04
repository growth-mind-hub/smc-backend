ALTER TABLE bookings
  ADD COLUMN booking_status TEXT NOT NULL DEFAULT 'NEW'
    CHECK (booking_status IN ('NEW', 'CONFIRMED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  ADD COLUMN assigned_drivers JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(assigned_drivers) = 'array');
CREATE INDEX bookings_created_at_idx ON bookings (created_at DESC, id DESC);
