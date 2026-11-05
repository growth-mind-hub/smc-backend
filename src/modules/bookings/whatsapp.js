import { Router } from 'express';
import { requireAdmin } from '../../middleware/admin.js';
import { sendError } from '../../middleware/errors.js';

export function whatsappProvider({ token = process.env.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID, version = process.env.WHATSAPP_API_VERSION,
  template = process.env.WHATSAPP_CONFIRMATION_TEMPLATE, language = process.env.WHATSAPP_TEMPLATE_LANGUAGE,
  fetchImpl = fetch } = {}) {
  return {
    assertReady() {
      if (!token || !/^\d+$/.test(phoneNumberId ?? '') || !/^v\d+\.\d+$/.test(version ?? '') ||
        !/^[a-z0-9_]+$/.test(template ?? '') || !/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(language ?? '')) {
        throw Object.assign(new Error('Configure the WhatsApp access token, phone number ID, API version, template and language.'),
          { code: 'WHATSAPP_NOT_CONFIGURED' });
      }
    },
    async sendConfirmation(booking) {
      this.assertReady();
      const texts = [booking.customer_name, booking.booking_number,
        `${booking.currency} ${(Number(booking.total_amount_minor) / 100).toFixed(2)}`,
        booking.pickup_address, booking.drop_address];
      const response = await fetchImpl(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ messaging_product: 'whatsapp', to: booking.customer_phone.replace(/^\+/, ''),
          type: 'template', template: { name: template, language: { code: language },
            components: [{ type: 'body', parameters: texts.map(text => ({ type: 'text', text })) }] } }),
      });
      if (!response.ok) { throw new Error('WhatsApp send could not be confirmed.'); }
      const result = await response.json();
      const id = result.messages?.[0]?.id;
      if (typeof id !== 'string' || !id) { throw new Error('WhatsApp did not return a message ID.'); }
      return id;
    },
  };
}

export function whatsappRoutes({ vehicleStore: store, adminApiKey, adminAuth, whatsapp }) {
  const router = Router();
  router.post('/bookings/:id/whatsapp-confirmation', requireAdmin(adminApiKey, adminAuth), async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|BK\d{11,})$/i.test(req.params.id) ||
      !req.body || Array.isArray(req.body) || req.body.whatsapp_opt_in !== true ||
      Object.keys(req.body).some(key => key !== 'whatsapp_opt_in')) {
      return sendError(req, res, 400, 'INVALID_INPUT', 'Use a booking UUID or booking number and send {"whatsapp_opt_in":true} only after obtaining customer consent.');
    }
    try {
      const booking = await store.getBooking(req.params.id);
      if (!booking) { return sendError(req, res, 404, 'NOT_FOUND', 'Booking not found.'); }
      if (booking.booking_status === 'CANCELLED' || !(booking.status === 'PAID' ||
        (booking.payment_method === 'MANUAL' && booking.booking_status === 'CONFIRMED'))) {
        return sendError(req, res, 409, 'BOOKING_NOT_CONFIRMED', 'A paid booking or confirmed manual booking is required.');
      }
      if (!/^\+[1-9]\d{6,14}$/.test(booking.customer_phone ?? '')) {
        return sendError(req, res, 400, 'INVALID_INPUT', 'The stored customer phone must use international format.');
      }
      whatsapp.assertReady();
      const claimed = await store.claimWhatsappConfirmation(booking.id);
      if (!claimed) {
        const existing = await store.getWhatsappConfirmation(booking.id);
        if (existing?.status === 'ACCEPTED') {
          return res.json({ success: true, status: 'ACCEPTED', message_id: existing.message_id, duplicate: true });
        }
        return sendError(req, res, 409, 'WHATSAPP_SEND_UNCERTAIN', 'A send attempt already exists. Check Meta delivery records before attempting any resend.');
      }
      try {
        const messageId = await whatsapp.sendConfirmation(booking);
        await store.finishWhatsappConfirmation(booking.id, 'ACCEPTED', messageId);
        return res.status(202).json({ success: true, status: 'ACCEPTED', message_id: messageId });
      } catch {
        await store.finishWhatsappConfirmation(booking.id, 'UNKNOWN', null);
        return sendError(req, res, 502, 'WHATSAPP_SEND_UNCERTAIN', 'Message acceptance could not be confirmed. Check Meta delivery records before attempting any resend.');
      }
    } catch (err) {
      if (err.code === 'WHATSAPP_NOT_CONFIGURED') { return sendError(req, res, 503, err.code, err.message); }
      return next(err);
    }
  });
  return router;
}
