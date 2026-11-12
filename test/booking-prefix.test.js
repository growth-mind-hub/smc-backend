import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

test('booking reads and notification endpoints accept SMC and legacy BK references', async () => {
  const app = createApp({ adminApiKey: 'secret', logger: { info() {}, error() {} }, vehicleStore: {
    async getBooking(id) { return { booking_number: id, status: 'PENDING_PAYMENT', booking_status: 'NEW' }; },
  } });
  for (const prefix of ['/api', '/api/v1']) {
    for (const id of ['SMC20261111001', 'BK20261111001']) {
      const result = await request(app).get(`${prefix}/bookings/${id}`).set('Authorization', 'Bearer secret').expect(200);
      assert.equal(result.body.booking.booking_number, id);
      await request(app).post(`${prefix}/bookings/${id}/email-confirmation`)
        .set('Authorization', 'Bearer secret').send({}).expect(409);
      await request(app).post(`${prefix}/bookings/${id}/whatsapp-confirmation`)
        .set('Authorization', 'Bearer secret').send({ whatsapp_opt_in: true }).expect(409);
    }
  }
});
