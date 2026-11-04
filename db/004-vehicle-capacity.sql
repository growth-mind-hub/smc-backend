ALTER TABLE vehicles ADD COLUMN luggage_capacity INTEGER CHECK (luggage_capacity BETWEEN 0 AND 100);
ALTER TABLE vehicles ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
-- Unknown luggage limits remain NULL until verified by an administrator.
