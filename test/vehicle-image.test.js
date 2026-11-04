import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZuoAAAAASUVORK5CYII=', 'base64');

test('vehicle images upload, replace, serve and delete with authorization and limits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'maxicab-images-'));
  const vehicle = { id: 1, imageUrl: null };
  let failSave = false;
  const store = {
    async get(id) { return id === 1 ? { ...vehicle } : null; },
    async setVehicleImage(id, imageUrl, beforeSave = async () => {}) {
      assert.equal(id, 1);
      if (failSave) { throw new Error('Database failure'); }
      const previousImageUrl = vehicle.imageUrl;
      await beforeSave(previousImageUrl);
      vehicle.imageUrl = imageUrl;
      return { vehicle: { ...vehicle }, previousImageUrl };
    },
  };
  const app = createApp({ vehicleStore: store, vehicleUploadDir: directory, adminApiKey: 'secret', logger: { info() {}, error() {} } });
  const upload = (buffer = png, field = 'image') => request(app).post('/api/v1/vehicles/1/image').set('Authorization', 'Bearer secret').attach(field, buffer, 'vehicle.png');
  try {
    await request(app).post('/api/v1/vehicles/1/image').attach('image', png, 'vehicle.png').expect(401);
    await request(app).delete('/api/v1/vehicles/1/image').expect(401);
    await request(app).post('/api/v1/vehicles/999/image').set('Authorization', 'Bearer secret').attach('image', png, 'vehicle.png').expect(404);
    await upload(Buffer.from('<svg></svg>')).expect(400);
    await upload(png, 'wrong').expect(400);
    await upload(Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
    await request(app).post('/api/v1/vehicles/1/image').set('Authorization', 'Bearer secret').expect(400);
    assert.deepEqual(await readdir(directory), []);
    const first = (await upload().expect(200)).body.vehicle.imageUrl;
    assert.equal(vehicle.imageUrl, first);
    const served = await request(app).get(first).expect(200);
    assert.deepEqual(served.body, png);
    assert.equal(served.headers['cross-origin-resource-policy'], 'cross-origin');
    const second = (await upload().expect(200)).body.vehicle.imageUrl;
    assert.notEqual(second, first);
    await request(app).get(first).expect(404);
    assert.equal((await readdir(directory)).length, 1);
    failSave = true;
    await upload().expect(500);
    assert.equal(vehicle.imageUrl, second);
    assert.equal((await readdir(directory)).length, 1);
    failSave = false;
    await request(app).delete('/api/v1/vehicles/1/image').set('Authorization', 'Bearer secret').expect(200);
    assert.equal(vehicle.imageUrl, null);
    assert.deepEqual(await readdir(directory), []);
    await request(app).delete('/api/vehicles/1/image').set('Authorization', 'Bearer secret').expect(200);
    const outside = join(directory, 'unrelated.txt');
    await writeFile(outside, 'keep');
    vehicle.imageUrl = '/uploads/vehicles/../unrelated.txt';
    await request(app).delete('/api/v1/vehicles/1/image').set('Authorization', 'Bearer secret').expect(200);
    assert.deepEqual(await readdir(directory), ['unrelated.txt']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
