import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID, createHash } from 'node:crypto';


import request from 'supertest';
import { createApp } from '../src/app.js';
import { openVehicleStore } from '../src/modules/vehicles/vehicle.repository.js';
import { migrate } from '../scripts/migrate.js';
import { calculateQuote, applyDistancePricing } from '../src/modules/add-ons/quote.js';
import { normalizeCheckout } from '../src/modules/bookings/checkout.validation.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
let store, app, admin, schema;
const integration = (name, fn) => test(name, { skip: !databaseUrl }, fn);
test.before(async () => {
  if (!databaseUrl) {return;}
  schema = 'test_' + randomUUID().replaceAll('-', '');
  admin = new pg.Pool({ connectionString: databaseUrl });
  await admin.query('CREATE SCHEMA ' + schema);
  const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  await migrate(pool);
  store = await openVehicleStore(databaseUrl, { pool });
  app = createApp({ vehicleStore: store, adminApiKey: 'test-secret', logger: { info() {}, error() {} } });
});
test.after(async () => {
  await store?.close();
  if (admin) {
    await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    await admin.end();
  }
});
const endpoint = '/api/v1/vehicles';
const vehicle = { name: 'New MPV', currency: 'SGD', passengerCapacity: 6,
  prices: { arrival: { amount: 90.25 }, departure_transfer: { amount: 80 }, hourly: { amount: 70, minimumHours: 3 } } };
const post = body => request(app).post(endpoint).set('Authorization', 'Bearer test-secret').send(body);

integration('fleet includes all supplied rates and qualifications', async () => {
  const { body } = await request(app).get(endpoint).expect(200);
  assert.equal(body.data.length, 12);
  assert.deepEqual(body.data.map(v => ['arrival', 'departure_transfer', 'hourly'].map(s => v.prices[s].amount)), [
    [90,80,70], [300,250,220], [75,65,60], [80,70,65], [95,85,75], [85,75,65], [95,90,85], [80,75,70], [150,130,100], [180,150,120], [90,85,80], [75,65,60],
  ]);
  assert.deepEqual(body.data.filter(v => v.prices.hourly.eightHourAmount !== null)
    .map(v => v.prices.hourly.eightHourAmount), [480,520,520,680,560,640,480]);
  assert.equal(body.data[9].prices.arrival.isFrom, true);
  assert.equal(body.data[7].prices.hourly.minimumHours, 3);
  assert.equal(body.data[6].description, '13 passengers, or 9 passengers with 8 bags');
});
integration('create and retrieve exact decimal price; reject duplicate names', async () => {
  const res = await post(vehicle).expect(201);
  assert.equal(res.body.vehicle.prices.arrival.amountMinor, 9025);
  const saved = await request(app).get(res.headers.location).expect(200);
  assert.deepEqual(saved.body.vehicle, res.body.vehicle);
  await post({ ...vehicle, name: ' new mpv ' }).expect(409);
  await request(app).get(`${endpoint}/99999`).expect(404);
});
integration('authorization and input validation', async () => {
  await request(app).post(endpoint).send(vehicle).expect(401);
  await request(app).post(endpoint).set('Authorization', 'Bearer wrong').send(vehicle).expect(401);
  for (const body of [{}, { ...vehicle, name: ' ' }, { ...vehicle, currency: 'sgd' },
    { ...vehicle, prices: { ...vehicle.prices, arrival: { amount: -1 } } },
    { ...vehicle, prices: { ...vehicle.prices, arrival: { amount: 1.001 } } },
    { ...vehicle, prices: { ...vehicle.prices, arrival: { amount: 1, minimumHours: 3 } } },
    { ...vehicle, prices: {} }, { ...vehicle, unknown: true }]) {await post(body).expect(400);}
});


integration('storage persists and seeds only once', async () => {
  await store.close();
  const pool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  store = await openVehicleStore(databaseUrl, { pool });
  const vehicles = await store.list();
  assert.equal(vehicles.length, 13);
  assert.equal(vehicles.find(v => v.name === 'New MPV').prices.arrival.amount, 90.25);
  // Failure in the price insert must roll back the parent vehicle insert.
  await assert.rejects(store.create({ ...vehicle, name: 'Rollback vehicle', prices: { ...vehicle.prices, hourly: { amount: -1 } } }));
  assert.equal((await store.list()).length, 13);
});

integration('admin updates are stored and joined into the public fleet response', async () => {
  app = createApp({ vehicleStore: store, adminApiKey: 'test-secret', logger: { info() {}, error() {} } });
  const send = (method, path, body) => request(app)[method](path).set('Authorization', 'Bearer test-secret').send(body);
  const id = (await store.list())[0].id;
  const catalogId = (await store.get(id)).prices.arrival.catalogId;
  assert.ok(Number.isInteger(catalogId));
  await send('patch', `${endpoint}/${id}`, { name: 'Updated Mercedes' }).expect(200);
  await send('put', `${endpoint}/${id}/prices/arrival`, { amount: 123.45, isFrom: true }).expect(200);
  await send('post', '/api/v1/services', { code: 'city_tour', name: 'City Tour', unit: 'hour' }).expect(201);
  await send('put', `${endpoint}/${id}/prices/city_tour`, { amount: 99, minimumHours: 2 }).expect(200);
  await send('patch', '/api/v1/services/city_tour', { name: 'Private City Tour' }).expect(200);
  const { body } = await request(app).get(endpoint).expect(200);
  const updated = body.data.find(v => v.id === id);
  assert.equal(updated.name, 'Updated Mercedes');
  assert.equal(updated.prices.arrival.amountMinor, 12345);
  assert.equal(updated.prices.arrival.catalogId, catalogId);
  const entry = await request(app).get(`/api/v1/catalog/${catalogId}`).expect(200);
  assert.equal(entry.body.catalog.vehicleId, id);
  assert.equal(entry.body.catalog.service, 'arrival');
  assert.equal(entry.body.catalog.price.amountMinor, 12345);
  assert.equal(updated.prices.arrival.isFrom, true);
  assert.equal(updated.prices.city_tour.serviceName, 'Private City Tour');
  assert.equal(updated.prices.city_tour.minimumHours, 2);
  assert.equal(updated.prices.city_tour.unit, 'hour');
});

integration('database recommendations require active vehicles with verified capacities', async () => {
  const vehicle = await store.create({ name: 'Verified recommendation MPV', currency: 'SGD', passengerCapacity: 6,
    luggageCapacity: 4, prices: Object.fromEntries((await store.listServices()).map(s => [s.code, { amount: 80 }])) });
  assert.ok((await store.recommend(4, 3)).some(v => v.id === vehicle.id));
  assert.ok(!(await store.recommend(4, 5)).some(v => v.id === vehicle.id));
  assert.ok(!(await store.recommend(7, 3)).some(v => v.id === vehicle.id));
  await store.updateVehicle(vehicle.id, { isActive: false });
  assert.ok(!(await store.list()).some(v => v.id === vehicle.id));
  assert.ok((await store.list({ includeInactive: true })).some(v => v.id === vehicle.id && v.status === 'inactive'));
  assert.ok(!(await store.recommend(4, 3)).some(v => v.id === vehicle.id));
  await store.updateVehicle(vehicle.id, { isActive: true, luggageCapacity: null });
  assert.ok(!(await store.recommend(4, 0)).some(v => v.id === vehicle.id));
});

integration('redesigned schema supports types, per-price currency and validity windows', async () => {
  const type = await store.createType({ name: 'Executive MPV', description: 'Premium carrier' });
  const target = (await store.list())[0];
  const updated = await store.updateVehicle(target.id, { vehicleTypeId: type.id, imageUrl: 'https://example.com/mpv.jpg', status: 'active' });
  assert.equal(updated.vehicleTypeId, type.id);
  assert.equal(updated.vehicleType, 'Executive MPV');
  assert.ok(updated.updatedAt);
  const catalogId = updated.prices.arrival.catalogId;
  await store.setPrice(target.id, 'arrival', { amount: 90, currency: 'USD', validFrom: '2099-01-01T00:00:00Z' });
  assert.equal((await store.get(target.id)).prices.arrival, undefined);
  assert.equal(await store.getCatalogEntry(catalogId), null);
  await store.setPrice(target.id, 'arrival', { amount: 90, currency: 'SGD', status: 'active' });
  assert.equal((await store.get(target.id)).prices.arrival.catalogId, catalogId);
  assert.equal((await store.get(target.id)).prices.arrival.currency, 'SGD');
});

integration('add-ons persist, migrations do not reset prices, and quotes use eligible database rates', async () => {
  const seeded = await store.listAddOns();
  assert.equal(seeded.length, 5);
  const night = seeded.find(item => item.code === 'NIGHT_TRAVEL');
  const stop = seeded.find(item => item.code === 'STOP_WITHIN_2KM');
  const target = await store.create({ name: 'Quote integration vehicle', currency: 'SGD',
    prices: Object.fromEntries((await store.listServices()).map(service => [service.code, { amount: 80 }])) });
  const arrival = (await store.listServices()).find(service => service.code === 'arrival');
  const input = { vehicle_id: target.id, service_id: arrival.id,
    add_ons: [{ add_on_id: night.id, quantity: 1 }, { add_on_id: stop.id, quantity: 2 }] };
  assert.equal(calculateQuote(input, await store.getQuoteCatalog(input)).total_amount, 110);
  await store.updateAddOn(night.id, { price: 15 });
  const migrationPool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  try { await migrate(migrationPool); } finally { await migrationPool.end(); }
  assert.equal((await store.listAddOns()).find(item => item.id === night.id).price, 15);
  assert.equal(calculateQuote(input, await store.getQuoteCatalog(input)).total_amount, 115);
  await store.updateAddOn(night.id, { status: 'INACTIVE' });
  assert.ok(!(await store.listAddOns()).some(item => item.id === night.id));
  const missingAddOnCatalog = await store.getQuoteCatalog(input);
  assert.throws(() => calculateQuote(input, missingAddOnCatalog), { code: 'NOT_FOUND' });
  await store.updateAddOn(night.id, { price: 10, status: 'ACTIVE' });
  await store.setPrice(target.id, 'arrival', { amount: 80, validFrom: '2099-01-01T00:00:00Z' });
  assert.equal(await store.getQuoteCatalog(input), null);
  await store.setPrice(target.id, 'arrival', { amount: 80 });
  await store.updateVehicle(target.id, { status: 'inactive' });
  assert.equal(await store.getQuoteCatalog(input), null);
});

integration('distance pricing migration persists rules and prevents overlapping active ranges', async () => {
  const seeded = await store.listDistanceRules();
  assert.equal(seeded.length, 5);
  const target = await store.create({ name: 'Distance quote integration vehicle', currency: 'SGD',
    prices: Object.fromEntries((await store.listServices()).map(service => [service.code, { amount: 80 }])) });
  const arrival = (await store.listServices()).find(service => service.code === 'arrival');
  const input = { vehicle_id: target.id, service_id: arrival.id, add_ons: [],
    pickup: { address: 'Changi Airport' }, drop: { address: 'Marina Bay Sands' } };
  const catalog = await store.getQuoteCatalog(input);
  const quote = calculateQuote(input, catalog);
  assert.equal(applyDistancePricing(input, quote, catalog.distance_rules, 29400).quote.total_amount, 85);
  assert.equal(applyDistancePricing(input, quote, catalog.distance_rules, 35000).quote.total_amount, 95);
  assert.equal(applyDistancePricing(input, quote, catalog.distance_rules, 35001).quote_status, 'CONTACT_SUPPORT');
  const second = seeded.find(rule => rule.min_distance_km === 28);
  await store.updateDistanceRule(second.id, { surcharge: 7.5 });
  const refreshed = await store.getQuoteCatalog(input);
  assert.equal(applyDistancePricing(input, quote, refreshed.distance_rules, 29400).quote.total_amount, 87.5);
  await assert.rejects(store.updateDistanceRule(second.id, { min_distance_km: 27 }), { code: '23P01' });
  await assert.rejects(store.updateDistanceRule(second.id, { is_contact_support: true }), { code: '23514' });
  const migrationPool = new pg.Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  try { await migrate(migrationPool); } finally { await migrationPool.end(); }
  assert.equal((await store.listDistanceRules()).find(rule => rule.id === second.id).surcharge, 7.5);
  await store.updateDistanceRule(second.id, { status: 'INACTIVE' });
  const gapCatalog = await store.getQuoteCatalog(input);
  assert.throws(() => applyDistancePricing(input, quote, gapCatalog.distance_rules, 29400), { code: 'DISTANCE_PRICING_UNAVAILABLE' });
  await store.updateDistanceRule(second.id, { surcharge: 5, status: 'ACTIVE' });
});

integration('checkout saves immutable snapshots, concurrent retries create one booking, and webhooks match the saved total', async () => {
  const target = await store.create({ name: 'Booking checkout integration vehicle', currency: 'SGD',
    prices: Object.fromEntries((await store.listServices()).map(service => [service.code, { amount: 80 }])) });
  const arrival = (await store.listServices()).find(service => service.code === 'arrival');
  const baby = (await store.listAddOns()).find(item => item.code === 'BABY_SEAT');
  const input = normalizeCheckout({ customer: { name: 'Integration Customer', email: 'integration@example.com', phone: '+6591234567' },
    vehicle_id: target.id, service_id: arrival.id, pickup: { address: 'Changi Airport' }, drop: { address: 'Marina Bay Sands' },
    add_ons: [{ add_on_id: baby.id, quantity: 1 }], payment_method: 'STRIPE' });
  const catalog = await store.getQuoteCatalog(input);
  const quote = applyDistancePricing(input, calculateQuote(input, catalog), catalog.distance_rules, 29400).quote;
  const key = randomUUID();
  const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const [first, second] = await Promise.all([store.createCheckoutBooking(input, quote, key, hash), store.createCheckoutBooking(input, quote, key, hash)]);
  assert.equal(first.id, second.id);
  const emailClaims = await Promise.all([store.claimEmailConfirmation(first.id), store.claimEmailConfirmation(first.id)]);
  assert.equal(emailClaims.filter(Boolean).length, 1);
  await store.finishEmailConfirmation(first.id, 'ACCEPTED', 'email-integration');
  assert.deepEqual(await store.getEmailConfirmation(first.id), { status: 'ACCEPTED', message_id: 'email-integration' });
  const notificationClaims = await Promise.all([
    store.claimWhatsappConfirmation(first.id), store.claimWhatsappConfirmation(first.id),
  ]);
  assert.equal(notificationClaims.filter(Boolean).length, 1);
  await store.finishWhatsappConfirmation(first.id, 'ACCEPTED', 'wamid.integration');
  assert.deepEqual(await store.getWhatsappConfirmation(first.id), { status: 'ACCEPTED', message_id: 'wamid.integration' });
  assert.match(first.booking_number, /^BK\d{8}\d{3,}$/);
  assert.equal(Number(first.total_amount_minor), 10500);
  assert.equal(first.status, 'PENDING_PAYMENT');
  await assert.rejects(store.createCheckoutBooking(input, quote, key, 'a'.repeat(64)), { code: 'IDEMPOTENCY_CONFLICT' });
  await store.updateAddOn(baby.id, { price: 25, name: 'Updated baby seat' });
  const saved = await store.getCheckoutByKey(key);
  assert.equal(saved.quote_snapshot.add_ons[0].unit_price, 20);
  assert.equal(saved.quote_snapshot.add_ons[0].name, baby.name);
  const children = await admin.query(`SELECT * FROM ${schema}.booking_add_ons WHERE booking_id = $1`, [first.id]);
  assert.equal(children.rows.length, 1);
  assert.equal(Number(children.rows[0].unit_price_minor), 2000);
  assert.equal(children.rows[0].add_on_name, baby.name);
  const failedKey = randomUUID();
  await assert.rejects(store.createCheckoutBooking(input, { ...quote, add_ons: [{ ...quote.add_ons[0], id: 2147483647 }] }, failedKey, hash), { code: '23503' });
  assert.equal(await store.getCheckoutByKey(failedKey), null);
  const session = { id: `cs_test_${first.id}`, url: 'https://checkout.stripe.com/test', livemode: false,
    expires_at: Math.floor(new Date(first.checkout_expires_at).getTime() / 1000) };
  await store.saveCheckoutSession(first.id, session);
  const sessionObject = { id: session.id, metadata: { booking_id: first.id }, client_reference_id: first.id,
    mode: 'payment', amount_total: 10500, currency: 'sgd', livemode: false, payment_status: 'unpaid' };
  await store.applyStripeEvent({ id: 'evt_unpaid_' + first.id, type: 'checkout.session.completed', data: { object: sessionObject } });
  assert.equal((await store.getCheckoutByKey(key)).status, 'PENDING_PAYMENT');
  await assert.rejects(store.applyStripeEvent({ id: 'evt_mismatch_' + first.id, type: 'checkout.session.completed',
    data: { object: { ...sessionObject, amount_total: 1, payment_status: 'paid' } } }), { code: 'PAYMENT_MISMATCH' });
  const event = { id: 'evt_paid_' + first.id, type: 'checkout.session.completed',
    data: { object: { ...sessionObject, metadata: { booking_id: first.booking_number, booking_uuid: first.id },
      payment_status: 'paid', payment_intent: 'pi_test_snapshot' } } };
  await assert.rejects(store.applyStripeEvent({ ...event, id: 'evt_wrong_number_' + first.id,
    data: { object: { ...event.data.object, metadata: { booking_id: 'BK_WRONG', booking_uuid: first.id } } } }), { code: 'PAYMENT_MISMATCH' });
  assert.equal((await store.applyStripeEvent(event)).status, 'PAID');
  assert.deepEqual(await store.applyStripeEvent(event), { duplicate: true, status: 'PAID', booking_id: first.id });
  assert.equal((await store.getBooking(first.id)).booking_status, 'CONFIRMED');
  await store.applyStripeEvent({ id: 'evt_expired_' + first.id, type: 'checkout.session.expired', data: { object: sessionObject } });
  const paid = await store.getCheckoutByKey(key);
  assert.equal(paid.status, 'PAID');
  assert.ok(paid.paid_at);
  assert.equal(paid.stripe_payment_intent_id, 'pi_test_snapshot');
  await store.updateAddOn(baby.id, { price: 20, name: baby.name });
});

integration('eight hour prices persist and are returned in vehicle lists', async () => {
  const created = await post({ ...vehicle, name: 'Eight hour package', prices: {
    ...vehicle.prices, hourly: { amount: 70, eightHourAmount: 480.25 },
  } }).expect(201);
  const id = created.body.vehicle.id;
  assert.equal(created.body.vehicle.prices.hourly.eightHourAmount, 480.25);
  await request(app).put(`${endpoint}/${id}/prices/hourly`)
    .set('Authorization', 'Bearer test-secret').send({ amount: 75 }).expect(200);
  const listed = await request(app).get(endpoint).expect(200);
  assert.equal(listed.body.data.find(v => v.id === id).prices.hourly.eightHourAmount, 480.25);
  await request(app).put(`${endpoint}/${id}/prices/hourly`)
    .set('Authorization', 'Bearer test-secret').send({ amount: 75, eightHourAmount: null }).expect(200);
  assert.equal((await store.get(id)).prices.hourly.eightHourAmount, null);
});

integration('three hour prices persist and are returned in vehicle lists', async () => {
  const created = await post({ ...vehicle, name: 'Three hour package', prices: {
    ...vehicle.prices, hourly: { amount: 70, threeHourAmount: 480.25 },
  } }).expect(201);
  const id = created.body.vehicle.id;
  assert.equal(created.body.vehicle.prices.hourly.threeHourAmount, 480.25);
  await request(app).put(`${endpoint}/${id}/prices/hourly`)
    .set('Authorization', 'Bearer test-secret').send({ amount: 75 }).expect(200);
  const listed = await request(app).get(endpoint).expect(200);
  assert.equal(listed.body.data.find(v => v.id === id).prices.hourly.threeHourAmount, 480.25);
  await request(app).put(`${endpoint}/${id}/prices/hourly`)
    .set('Authorization', 'Bearer test-secret').send({ amount: 75, threeHourAmount: null }).expect(200);
  assert.equal((await store.get(id)).prices.hourly.threeHourAmount, null);
});
