import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';

const secret = 'test-app-secret';
function fixture({ fail = false, config = { verifyToken: 'test-verify', appSecret: secret } } = {}) {
  const events = new Map();
  return { events, app: createApp({ logger: { info() {}, error() {} }, whatsappWebhookConfig: config,
    vehicleStore: { async saveWhatsappWebhook(hash, payload) {
      if (fail) { throw new Error('database down'); }
      events.set(hash, payload);
    } } }) };
}
const signature = raw => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
const payload = { object: 'whatsapp_business_account', entry: [{ id: 'test-account', changes: [{ field: 'messages', value: {
  messaging_product: 'whatsapp', metadata: { phone_number_id: '12345' },
  statuses: [{ id: 'wamid.test', status: 'delivered', timestamp: '1793880000', recipient_id: '6591234567' }],
} }] }] };

test('GET verification returns plain-text challenge on both prefixes without admin authentication', async () => {
  const { app } = fixture();
  for (const prefix of ['/api', '/api/v1']) {
    const result = await request(app).get(`${prefix}/whatsapp/webhook`).query({
      'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify', 'hub.challenge': '123456',
    }).expect(200);
    assert.equal(result.text, '123456');
    assert.match(result.headers['content-type'], /text\/plain/);
  }
  await request(app).get('/api/v1/whatsapp/webhook').query({
    'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '123456',
  }).expect(403);
  await request(app).get('/api/v1/whatsapp/webhook').expect(403);
  await request(fixture({ config: { verifyToken: '', appSecret: '' } }).app).get('/api/whatsapp/webhook').expect(503);
});

test('signed delivery and incoming events are stored; duplicates acknowledged', async () => {
  const { app, events } = fixture();
  const raw = JSON.stringify(payload, null, 2);
  for (const prefix of ['/api', '/api/v1']) {
    await request(app).post(`${prefix}/whatsapp/webhook`).set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature(raw)).send(raw).expect(200);
  }
  assert.equal(events.size, 1);
  assert.deepEqual([...events.values()][0], payload);
  const incoming = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
    messages: [{ id: 'wamid.incoming', type: 'text', text: { body: 'Hello' }, from: '6591234567' }],
  } }] }] });
  await request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', signature(incoming)).send(incoming).expect(200);
  assert.equal(events.size, 2);
});

test('forged, tampered, malformed and oversized requests cannot be accepted', async () => {
  const { app, events } = fixture();
  const raw = JSON.stringify(payload);
  const send = body => request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').send(body);
  await send(raw).expect(401);
  await send(raw).set('X-Hub-Signature-256', 'sha256=bad').expect(401);
  await send(raw + ' ').set('X-Hub-Signature-256', signature(raw)).expect(401);
  await send('{').set('X-Hub-Signature-256', signature('{')).expect(400);
  await send('{}').set('X-Hub-Signature-256', signature('{}')).expect(400);
  await send('x'.repeat(270000)).expect(413);
  assert.equal(events.size, 0);
});

test('database failures return an error so Meta can retry', async () => {
  const { app } = fixture({ fail: true });
  const raw = JSON.stringify(payload);
  await request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', signature(raw)).send(raw).expect(500);
});
