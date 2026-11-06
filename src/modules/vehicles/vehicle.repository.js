import { createDatabasePool } from '../../database/pool.js';
import { validateVehicle } from './vehicle.validation.js';
import { addOnRepository } from '../add-ons/add-on.repository.js';
import { distanceRuleRepository } from '../add-ons/distance-rule.repository.js';
import { bookingRepository } from '../bookings/booking.repository.js';
import { adminRepository } from '../admin/admin.repository.js';


function mapRows(rows) {
  const vehicles = new Map();
  for (const row of rows) {
    if (!vehicles.has(row.id)) {vehicles.set(row.id, {
      id: row.id, name: row.name, description: row.description,
      passengerCapacity: row.passenger_capacity, currency: null,
      passengerCapacityWithLuggage: row.passenger_capacity_with_luggage,
      wheelchairCapacity: row.wheelchair_capacity, recommendationPriority: row.recommendation_priority,
      vehicleTypeId: row.vehicle_type_id, vehicleType: row.vehicle_type_name, imageUrl: row.image_url, status: row.status, updatedAt: row.updated_at.toISOString(),
      luggageCapacity: row.luggage_capacity, isActive: row.status === 'active',
      createdAt: row.created_at.toISOString(), prices: {},
    });}
    if (row.service) {vehicles.get(row.id).prices[row.service] = {
      catalogId: row.catalog_id,
      serviceId: row.service_id,
      threeHourAmount: row.three_hour_amount == null ? null : Number(row.three_hour_amount),
      eightHourAmount: row.eight_hour_amount == null ? null : Number(row.eight_hour_amount),
      amount: Number(row.price), amountMinor: Math.round(Number(row.price) * 100), currency: row.currency,
      validFrom: row.valid_from.toISOString(), validTo: row.valid_to?.toISOString() ?? null, status: row.price_status,
      isFrom: row.is_from, unit: row.unit, serviceName: row.service_name, minimumHours: row.minimum_hours,
    };}
  }
  for (const vehicle of vehicles.values()) {
    const currencies = [...new Set(Object.values(vehicle.prices).map(p => p.currency))];
    vehicle.currency = currencies.length === 1 ? currencies[0] : null;
  }
  return [...vehicles.values()];
}
const select = `SELECT v.*, t.name AS vehicle_type_name, p.id AS catalog_id, s.service_code AS service,
  p.service_id, p.three_hour_amount, p.eight_hour_amount, p.price, p.currency, p.is_from, p.minimum_hours, p.valid_from, p.valid_to, p.status AS price_status,
  s.pricing_unit AS unit, s.service_name FROM vehicles v
  LEFT JOIN vehicle_types t ON t.id = v.vehicle_type_id
  LEFT JOIN vehicle_service_prices p ON p.vehicle_id = v.id AND p.status = 'active'
    AND p.valid_from <= CURRENT_TIMESTAMP AND (p.valid_to IS NULL OR p.valid_to > CURRENT_TIMESTAMP)
  LEFT JOIN services s ON s.id = p.service_id AND s.status = 'active'`;
const serviceSelect = 'SELECT id, service_code AS code, service_name AS name, pricing_unit AS unit, status, sort_order AS "sortOrder" FROM services';

export async function openVehicleStore(connectionString = process.env.DATABASE_URL, { pool: suppliedPool } = {}) {
  if (!connectionString && !suppliedPool) {throw new Error('DATABASE_URL is required.');}
  const pool = suppliedPool ?? createDatabasePool(connectionString);

  const transaction = async fn => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) { await client.query('ROLLBACK'); throw err; }
    finally { client.release(); }
  };
  const get = async (id, client = pool) => mapRows((await client.query(select + ' WHERE v.id = $1 ORDER BY s.service_code', [id])).rows)[0] ?? null;
  const listServices = async (client = pool) => (await client.query(serviceSelect + " WHERE status = 'active' ORDER BY sort_order, service_code")).rows;
  const insertVehicle = async (client, vehicle) => {
    const serviceRows = await listServices(client);
    const details = validateVehicle(vehicle, serviceRows);
    if (details.length) {throw Object.assign(new Error('Invalid vehicle data'), { code: 'INVALID_INPUT', details });}
    const { rows: [row] } = await client.query(
      'INSERT INTO vehicles (name, description, passenger_capacity, luggage_capacity, status, vehicle_type_id, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [vehicle.name, vehicle.description ?? '', vehicle.passengerCapacity ?? null, vehicle.luggageCapacity ?? null, vehicle.status ?? (vehicle.isActive === false ? 'inactive' : 'active'), vehicle.vehicleTypeId ?? null, vehicle.imageUrl ?? null]);
    for (const { code: service, id: serviceId } of serviceRows) {
      const price = vehicle.prices[service];
      await client.query('INSERT INTO vehicle_service_prices (vehicle_id, service_id, price, currency, is_from, minimum_hours, eight_hour_amount, three_hour_amount) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [row.id, serviceId, price.amount, vehicle.currency, price.isFrom ?? false, price.minimumHours ?? null, price.eightHourAmount ?? null, price.threeHourAmount ?? null]);
    }
    return get(row.id, client);
  };
  try { await pool.query('SELECT 1 FROM vehicles LIMIT 0'); await pool.query('SELECT 1 FROM services LIMIT 0'); await pool.query('SELECT 1 FROM vehicle_service_prices LIMIT 0'); }
  catch (err) { if (!suppliedPool) {await pool.end();} throw err; }
  return {
    ...adminRepository(pool),
    ...addOnRepository(pool),
    ...distanceRuleRepository(pool),
    ...bookingRepository(pool, transaction),
    listTypes: async () => (await pool.query('SELECT id, name, description FROM vehicle_types ORDER BY id')).rows,
    createType: async body => (await pool.query('INSERT INTO vehicle_types (name, description) VALUES ($1, $2) RETURNING *', [body.name.trim(), body.description ?? ''])).rows[0],
    updateType: async (id, body) => (await pool.query('UPDATE vehicle_types SET name = COALESCE($2, name), description = COALESCE($3, description) WHERE id = $1 RETURNING *', [id, body.name?.trim() ?? null, body.description ?? null])).rows[0] ?? null,
    get, listServices, create: vehicle => transaction(client => insertVehicle(client, vehicle)),
    getCatalogEntry: async catalogId => {
      const { rows } = await pool.query(select + " WHERE p.id = $1 AND v.status = 'active' AND s.id IS NOT NULL", [catalogId]);
      if (!rows.length) { return null; }
      const vehicle = mapRows(rows)[0];
      const service = rows[0].service;
      return { catalogId, vehicleId: vehicle.id, vehicleName: vehicle.name,
        currency: vehicle.currency, service, price: vehicle.prices[service] };
    },
    setVehicleImage: (id, imageUrl, beforeSave = async () => {}) => transaction(async client => {
      const row = (await client.query('SELECT image_url FROM vehicles WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!row) { return null; }
      await beforeSave(row.image_url);
      await client.query('UPDATE vehicles SET image_url = $2 WHERE id = $1', [id, imageUrl]);
      return { vehicle: await get(id, client), previousImageUrl: row.image_url };
    }),
    updateVehicle: (id, body) => transaction(async client => {
      const result = await client.query(`UPDATE vehicles SET
        name = COALESCE($2, name), description = COALESCE($3, description),
        passenger_capacity = CASE WHEN $4 THEN $5 ELSE passenger_capacity END,
        luggage_capacity = CASE WHEN $6 THEN $7 ELSE luggage_capacity END,
        status = COALESCE($8, status),
        vehicle_type_id = CASE WHEN $9 THEN $10 ELSE vehicle_type_id END,
        image_url = CASE WHEN $11 THEN $12 ELSE image_url END
        WHERE id = $1 RETURNING id`,
      [id, body.name?.trim() ?? null, body.description ?? null, Object.hasOwn(body, 'passengerCapacity'), body.passengerCapacity ?? null,
        Object.hasOwn(body, 'luggageCapacity'), body.luggageCapacity ?? null, body.status ?? (body.isActive === undefined ? null : body.isActive ? 'active' : 'inactive'),
        Object.hasOwn(body, 'vehicleTypeId'), body.vehicleTypeId ?? null, Object.hasOwn(body, 'imageUrl'), body.imageUrl ?? null]);
      return result.rowCount ? get(id, client) : null;
    }),
    setPrice: (id, service, price) => transaction(async client => {
      // Lock the parent while writing its price and reading the combined response.
      if (!(await client.query('SELECT id FROM vehicles WHERE id = $1 FOR UPDATE', [id])).rowCount) { return null; }
      const serviceRow = (await client.query("SELECT id FROM services WHERE service_code = $1 AND status = 'active'", [service])).rows[0];
      if (!serviceRow) { throw Object.assign(new Error('Service not found'), { code: 'NOT_FOUND' }); }
      const existing = (await client.query('SELECT currency, eight_hour_amount, three_hour_amount FROM vehicle_service_prices WHERE vehicle_id = $1 AND service_id = $2', [id, serviceRow.id])).rows[0];
      const currency = price.currency ?? existing?.currency ?? (await get(id, client)).currency;
      if (!currency) { throw Object.assign(new Error('Currency is required for this price'), { code: 'INVALID_INPUT', details: ['currency is required for a new price.'] }); }
      await client.query(`INSERT INTO vehicle_service_prices (vehicle_id, service_id, price, currency, is_from, minimum_hours, valid_from, valid_to, status, eight_hour_amount, three_hour_amount)
        VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, CURRENT_TIMESTAMP), $8, $9, $10, $11)
        ON CONFLICT (vehicle_id, service_id) DO UPDATE SET
        three_hour_amount = EXCLUDED.three_hour_amount, eight_hour_amount = EXCLUDED.eight_hour_amount, price = EXCLUDED.price, currency = EXCLUDED.currency, is_from = EXCLUDED.is_from,
        minimum_hours = EXCLUDED.minimum_hours, valid_from = EXCLUDED.valid_from, valid_to = EXCLUDED.valid_to, status = EXCLUDED.status`,
      [id, serviceRow.id, price.amount, currency, price.isFrom ?? false, price.minimumHours ?? null, price.validFrom ?? null, price.validTo ?? null, price.status ?? 'active', Object.hasOwn(price, 'eightHourAmount') ? price.eightHourAmount : existing?.eight_hour_amount ?? null, Object.hasOwn(price, 'threeHourAmount') ? price.threeHourAmount : existing?.three_hour_amount ?? null]);
      return get(id, client);
    }),
    createService: async body => {
      const { rows } = await pool.query(`INSERT INTO services (service_code, service_name, pricing_unit, sort_order, status)
        VALUES ($1, $2, $3, $4, $5) RETURNING id, service_code AS code, service_name AS name, pricing_unit AS unit, status, sort_order AS "sortOrder"`,
      [body.code, body.name.trim(), body.unit, body.sortOrder ?? 0, body.status ?? 'active']);
      return rows[0];
    },
    updateService: async (code, body) => {
      const { rows } = await pool.query(`UPDATE services SET service_name = COALESCE($2, service_name),
        sort_order = COALESCE($3, sort_order), status = COALESCE($4, status) WHERE service_code = $1
        RETURNING id, service_code AS code, service_name AS name, pricing_unit AS unit, status, sort_order AS "sortOrder"`,
      [code, body.name?.trim() ?? null, body.sortOrder ?? null, body.status ?? null]);
      return rows[0] ?? null;
    },
    list: async ({ includeInactive = false } = {}) => mapRows((await pool.query(select +
      (includeInactive ? '' : " WHERE v.status = 'active'") + ' ORDER BY v.id, s.service_code')).rows),
    recommend: async (persons, luggage) => mapRows((await pool.query(select + `
      WHERE v.status = 'active' AND v.passenger_capacity >= $1 AND v.luggage_capacity >= $2
      AND EXISTS (SELECT 1 FROM vehicle_service_prices configured JOIN services cs ON cs.id = configured.service_id WHERE configured.vehicle_id = v.id AND configured.status = 'active' AND cs.status = 'active' AND configured.valid_from <= CURRENT_TIMESTAMP AND (configured.valid_to IS NULL OR configured.valid_to > CURRENT_TIMESTAMP))
      ORDER BY (v.passenger_capacity - $1 + v.luggage_capacity - $2), v.passenger_capacity, v.luggage_capacity, v.id, s.service_code`, [persons, luggage])).rows),
    ready: async () => { await pool.query('SELECT 1'); },
    close: () => pool.end(),
  };
}
