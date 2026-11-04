import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const logger = { info() {}, error() {} };
const vehicleStore = { async list() { return []; } };
const app = createApp({ logger, vehicleStore });
const endpoint = '/api/v1/vehicles';

test('malformed JSON, oversized body and missing route', async () => {
  await request(app).post(endpoint).set('Content-Type', 'application/json').send('{').expect(400);
  await request(app).post(endpoint).send({ text: 'x'.repeat(11000) }).expect(413);
  await request(app).get('/missing').expect(404);
});

test('legacy sample recommendation endpoint is removed', async () => {
  await request(app).post('/api/v1/cab-recommendations').send({ persons: 4, luggage: 6 }).expect(404);
});

test('rate limiting and health', async () => {
  const limited = createApp({ rateLimitMax: 1, logger, vehicleStore });
  await request(limited).get(endpoint).expect(200);
  await request(limited).get(endpoint).expect(429);
  const { body } = await request(limited).get('/health').expect(200);
  assert.equal(body.status, 'ok');
});
