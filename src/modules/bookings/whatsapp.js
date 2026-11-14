import { Router } from 'express';
import { requireAdmin } from '../../middleware/admin.js';
import { sendError } from '../../middleware/errors.js';

export function confirmationParameters(booking) {
  // Match the variable order in the operator's approved Twilio Content template.
  const money = minor => `${booking.currency} ${(Number(minor ?? 0) / 100).toFixed(2)}`;
  const parts = [`Vehicle fare: ${money(booking.vehicle_amount_minor)}`];
  if (Number(booking.distance_amount_minor) > 0) { parts.push(`Distance charge: ${money(booking.distance_amount_minor)}`); }
  const addOns = booking.quote_snapshot?.add_ons ?? [];
  if (addOns.length) {
    parts.push(...addOns.map(item => `${item.name} x ${item.quantity}: ${money(Math.round(Number(item.amount) * 100))}`));
  } else if (Number(booking.add_on_amount_minor) > 0) { parts.push(`Add-ons: ${money(booking.add_on_amount_minor)}`); }
  if (Number(booking.card_surcharge_minor) > 0) { parts.push(`Card surcharge: ${money(booking.card_surcharge_minor)}`); }
  return [booking.customer_name, booking.customer_phone, booking.booking_number,
    booking.quote_snapshot?.vehicle?.name ?? 'Not provided', booking.pickup_address, booking.drop_address,
    parts.join('; '), (Number(booking.total_amount_minor) / 100).toFixed(2),
    booking.status === 'PAID' ? 'Payment received. Thank you.' : 'Payment pending. We will send you payment details shortly.',
  ].map(value => String(value ?? 'Not provided').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, ' ').trim() || 'Not provided');
}

export async function sendPaidBookingWhatsapp(store, whatsapp, id) {
  const booking = await store.getBooking(id);
  if (!booking || booking.status !== 'PAID' || booking.booking_status === 'CANCELLED' || booking.whatsapp_opt_in !== true) {
    return { skipped: true };
  }
  whatsapp.assertReady();
  if (!await store.claimWhatsappConfirmation(booking.id)) {
    const existing = await store.getWhatsappConfirmation(booking.id);
    return { status: existing?.status ?? 'UNKNOWN', duplicate: true };
  }
  try {
    const messageId = await whatsapp.sendConfirmation(booking);
    await store.finishWhatsappConfirmation(booking.id, 'ACCEPTED', messageId);
    return { status: 'ACCEPTED' };
  } catch {
    await store.finishWhatsappConfirmation(booking.id, 'UNKNOWN', null);
    return { status: 'UNKNOWN' };
  }
}

export function whatsappProvider({ accountSid = process.env.TWILIO_ACCOUNT_SID,
  authToken = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_WHATSAPP_FROM,
  contentSid = process.env.TWILIO_WHATSAPP_CONTENT_SID,
  fetchImpl = fetch } = {}) {
  return {
    assertReady() {
      if (!/^AC[a-f0-9]{32}$/i.test(accountSid ?? '') || !authToken ||
        !/^whatsapp:\+[1-9]\d{6,14}$/.test(from ?? '') || !/^HX[a-f0-9]{32}$/i.test(contentSid ?? '')) {
        throw Object.assign(new Error('Configure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM and TWILIO_WHATSAPP_CONTENT_SID.'),
          { code: 'WHATSAPP_NOT_CONFIGURED' });
      }
    },
    async sendConfirmation(booking) {
      this.assertReady();
      if (!/^\+[1-9]\d{6,14}$/.test(booking.customer_phone ?? '')) { throw new Error('Invalid stored customer phone.'); }
      const variables = Object.fromEntries(confirmationParameters(booking).map((text, index) => [String(index + 1), text]));
      const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST', headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({ From: from, To: `whatsapp:${booking.customer_phone}`, ContentSid: contentSid,
          ContentVariables: JSON.stringify(variables) }).toString(),
      });
      if (!response.ok) { throw new Error('WhatsApp send could not be confirmed.'); }
      const result = await response.json();
      if (!/^(?:SM|MM)[a-f0-9]{32}$/i.test(result.sid ?? '') || ['failed', 'undelivered', 'canceled'].includes(result.status)) {
        throw new Error('Twilio did not accept the WhatsApp message.');
      }
      return result.sid;
    },
  };
}

export function whatsappRoutes({ vehicleStore: store, adminApiKey, adminAuth, whatsapp }) {
  const router = Router();
  router.post('/bookings/:id/whatsapp-confirmation', requireAdmin(adminApiKey, adminAuth), async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?:SMC|BK)\d{11,})$/i.test(req.params.id) ||
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
        return sendError(req, res, 409, 'WHATSAPP_SEND_UNCERTAIN', 'A send attempt already exists. Check Twilio delivery records before attempting any resend.');
      }
      try {
        const messageId = await whatsapp.sendConfirmation(booking);
        await store.finishWhatsappConfirmation(booking.id, 'ACCEPTED', messageId);
        return res.status(202).json({ success: true, status: 'ACCEPTED', message_id: messageId });
      } catch {
        await store.finishWhatsappConfirmation(booking.id, 'UNKNOWN', null);
        return sendError(req, res, 502, 'WHATSAPP_SEND_UNCERTAIN', 'Message acceptance could not be confirmed. Check Twilio delivery records before attempting any resend.');
      }
    } catch (err) {
      if (err.code === 'WHATSAPP_NOT_CONFIGURED') { return sendError(req, res, 503, err.code, err.message); }
      return next(err);
    }
  });
  return router;
}
