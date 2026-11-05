import { readFile } from 'node:fs/promises';

export async function migrate(pool) {
  const schema = await readFile(new URL('../db/001-vehicles.sql', import.meta.url), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Prevent concurrent deploys from applying migrations twice.
    await client.query('SELECT pg_advisory_xact_lock(74923001)');
    if (!(await client.query("SELECT to_regclass('schema_migrations') AS name")).rows[0].name) {
      await client.query(schema);
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 2')).rowCount) {
      await client.query(await readFile(new URL('../db/002-services.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (2)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 1')).rowCount) {
      await client.query(await readFile(new URL('../db/seed-fleet.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (1)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 3')).rowCount) {
      await client.query(await readFile(new URL('../db/003-catalog-id.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (3)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 4')).rowCount) {
      await client.query(await readFile(new URL('../db/004-vehicle-capacity.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (4)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 5')).rowCount) {
      await client.query(await readFile(new URL('../db/005-catalog-redesign.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (5)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 6')).rowCount) {
      await client.query(await readFile(new URL('../db/006-example-luggage-capacities.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (6)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 7')).rowCount) {
      await client.query(await readFile(new URL('../db/007-add-ons.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (7)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 8')).rowCount) {
      await client.query(await readFile(new URL('../db/008-distance-pricing.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (8)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 9')).rowCount) {
      await client.query(await readFile(new URL('../db/009-booking-checkout.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (9)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 10')).rowCount) {
      await client.query(await readFile(new URL('../db/010-admin-users.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (10)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 11')).rowCount) {
      await client.query(await readFile(new URL('../db/011-booking-management.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (11)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 12')).rowCount) {
      await client.query(await readFile(new URL('../db/012-booking-driver-text.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (12)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 13')).rowCount) {
      await client.query(await readFile(new URL('../db/013-eight-hour-price.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (13)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 14')).rowCount) {
      await client.query(await readFile(new URL('../db/014-fleet-price-update.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (14)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 15')).rowCount) {
      await client.query(await readFile(new URL('../db/015-three-hour-price.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (15)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 16')).rowCount) {
      await client.query(await readFile(new URL('../db/016-booking-selector-prices.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (16)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 17')).rowCount) {
      await client.query(await readFile(new URL('../db/017-fleet-capacities.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (17)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 18')).rowCount) {
      await client.query(await readFile(new URL('../db/018-delete-completed-booking-add-ons.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (18)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 19')).rowCount) {
      await client.query(await readFile(new URL('../db/019-manual-bookings.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (19)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 20')).rowCount) {
      await client.query(await readFile(new URL('../db/020-fleet-descriptions.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (20)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 21')).rowCount) {
      await client.query(await readFile(new URL('../db/021-missing-eight-hour-rates.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (21)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 22')).rowCount) {
      await client.query(await readFile(new URL('../db/022-expand-fleet-descriptions.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (22)');
    }
    if (!(await client.query('SELECT version FROM schema_migrations WHERE version = 23')).rowCount) {
      await client.query(await readFile(new URL('../db/023-whatsapp-confirmations.sql', import.meta.url), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES (23)');
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
