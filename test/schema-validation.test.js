import test from 'node:test';
import assert from 'node:assert/strict';
import { validateVehicleUpdate, validatePrice, validateService } from '../src/modules/vehicles/admin.validation.js';

test('redesigned fields validate status, vehicle type, images and price windows', () => {
  assert.deepEqual(validateVehicleUpdate({ vehicleTypeId: 2, imageUrl: 'https://example.com/car.jpg', status: 'active' }), []);
  assert.ok(validateVehicleUpdate({ vehicleTypeId: -1, status: 'deleted' }).length);
  assert.ok(validateVehicleUpdate({ imageUrl: 'javascript:alert(1)' }).length);
  assert.deepEqual(validateService({ status: 'inactive' }), []);
  const service = { unit: 'trip' };
  assert.deepEqual(validatePrice({ amount: 90, currency: 'SGD', validFrom: '2026-10-02T00:00:00Z', validTo: null }, service), []);
  assert.ok(validatePrice({ amount: 90, currency: 'sgd' }, service).length);
  assert.ok(validatePrice({ amount: 90, validFrom: '2026-10-02T00:00:00Z', validTo: '2026-10-01T00:00:00Z' }, service).length);
});
