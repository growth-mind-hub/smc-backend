import test from 'node:test';
import assert from 'node:assert/strict';
import { annotateVehicles, parseRequirements } from '../src/modules/recommendations/vehicle-list-recommendation.js';

const vehicle = (id, name, passengers, bags, withBags, priority, wheelchair = 0) => ({
  id, name, status: 'active', isActive: true, passengerCapacity: passengers, luggageCapacity: bags,
  passengerCapacityWithLuggage: withBags, recommendationPriority: priority, wheelchairCapacity: wheelchair,
  prices: { arrival: { amount: 80 } },
});
const fleet = [vehicle(1, 'Mercedes E Class', 3, 3, 3, 10), vehicle(2, 'Mercedes S Class', 3, 3, 3, 10),
  vehicle(3, 'Toyota Alphard / Vellfire', 6, 6, null, 100), vehicle(5, 'Mercedes V-Class (New)', 7, 7, 7, 20),
  vehicle(6, 'Toyota Hiace 13 seater Minibus', 13, 9, 9, 30),
  vehicle(8, '7 Seater Maxi Cab Wheelchair', 3, null, 3, 10, 1),
  vehicle(11, '9 Seater Maxi Cab Wheelchair', 5, null, 5, 20, 1),
  vehicle(9, '23 Seater Coaches', 23, 0, 0, 40), vehicle(10, '40 Seater Coaches', 40, 40, 30, 50)];
const best = (persons, luggage, wheelchair = false, vehicles = fleet) => annotateVehicles(vehicles,
  { persons, luggage, wheelchair }).data.find(v => v.recommendation)?.id;

test('sedans fit up to three passengers and bags, then V-Class is preferred', () => {
  assert.equal(best(2, 3), 1);
  assert.equal(best(3, 3), 1);
  assert.equal(best(2, 4), 5);
  assert.equal(best(4, 1), 5);
  assert.equal(best(7, 7), 5);
});
test('13-seater supports thirteen without luggage or nine passengers with nine bags', () => {
  assert.equal(best(8, 7), 6);
  assert.equal(best(7, 8), 6);
  assert.equal(best(9, 9), 6);
  assert.equal(best(13, 0), 6);
  assert.equal(best(10, 1), 10);
  assert.equal(best(9, 10), 10);
});
test('coaches enforce no bags for 23-seater and thirty passengers with forty bags for 40-seater', () => {
  assert.equal(best(19, 0), 9);
  assert.equal(best(23, 0), 9);
  assert.equal(best(23, 1), 10);
  assert.equal(best(40, 0), 10);
  assert.equal(best(30, 40), 10);
  assert.equal(best(31, 1), undefined);
  assert.equal(best(30, 41), undefined);
  assert.equal(best(41, 0), undefined);
});
test('wheelchair requests use accompanying passenger count and never select standard vehicles', () => {
  assert.equal(best(0, 0, true), 8);
  assert.equal(best(3, 0, true), 8);
  assert.equal(best(4, 0, true), 11);
  assert.equal(best(5, 0, true), 11);
  assert.equal(best(6, 0, true), undefined);
  assert.equal(best(3, 1, true), undefined);
  assert.equal(best(3, 0), 1);
});
test('inactive or unpriced preferred vehicles are never recommended', () => {
  const unavailable = fleet.map(v => v.id === 5 ? { ...v, status: 'inactive', isActive: false } : v);
  assert.equal(best(7, 7, false, unavailable), 6);
  assert.equal(best(7, 7, false, fleet.map(v => v.id === 5 ? { ...v, prices: {} } : v)), 6);
});
test('wheelchair flag is validated and remains optional for existing callers', () => {
  assert.deepEqual(parseRequirements({ persons: '2', luggage: '3' }).requirements, { persons: 2, luggage: 3 });
  assert.deepEqual(parseRequirements({ persons: '0', luggage: '0', wheelchair: 'true' }).details, []);
  assert.ok(parseRequirements({ persons: '0', luggage: '0' }).details.length);
  assert.ok(parseRequirements({ persons: '3', luggage: '0', wheelchair: 'yes' }).details.length);
});
