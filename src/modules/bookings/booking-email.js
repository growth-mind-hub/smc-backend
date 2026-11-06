import nodemailer from 'nodemailer';
import { Router } from 'express';
import { requireAdmin } from '../../middleware/admin.js';
import { sendError } from '../../middleware/errors.js';

const emailAddress = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function bookingEmailContent(booking) {
  const money = minor => `${booking.currency} ${(Number(minor ?? 0) / 100).toFixed(2)}`;
  const details = [
    ['Booking number', booking.booking_number], ['Customer', booking.customer_name],
    ['Phone', booking.customer_phone], ['Booking status', booking.booking_status], ['Payment status', booking.status],
    ['Vehicle', booking.quote_snapshot?.vehicle?.name], ['Service', booking.quote_snapshot?.service?.name],
    ['Pickup', booking.pickup_address], ['Drop-off', booking.drop_address],
    ['Hours', booking.hours], ['Distance', booking.distance_meters == null ? null : `${booking.distance_meters / 1000} km`],
    ['Vehicle fare', money(booking.vehicle_amount_minor)], ['Distance charge', money(booking.distance_amount_minor)],
    ['Add-ons', money(booking.add_on_amount_minor)], ['Card surcharge', money(booking.card_surcharge_minor)],
    ['Total booking amount', money(booking.total_amount_minor)],
    ['Driver', booking.driver_name], ['Driver phone', booking.driver_phone],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
  for (const addOn of booking.quote_snapshot?.add_ons ?? []) {
    details.push(['Selected add-on', `${addOn.name} × ${addOn.quantity}`]);
  }
  return {
    subject: `Booking confirmation - ${String(booking.booking_number).replace(/[\r\n]/g, '')}`,
    text: `Thank you for booking with Singapore Maxicabs.\n\n${details.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\nNeed help? Contact support: booking@singaporemaxicabs.com.sg or call +65 8800 6006. You can also reply to this email.`,
    html: `<h2>Singapore Maxicabs — Booking confirmation</h2><p>Thank you for your booking.</p><table>${details.map(([label, value]) =>
      `<tr><th scope="row" style="text-align:left;padding:6px">${escapeHtml(label)}</th><td style="padding:6px">${escapeHtml(value)}</td></tr>`).join('')}</table><hr style="border:0;border-top:1px solid #ddd;margin:24px 0"><p>Need help with your booking?</p><p><a href="mailto:booking@singaporemaxicabs.com.sg" style="display:inline-block;background:#174a73;color:#fff;padding:12px 20px;text-decoration:none;border-radius:4px">Contact support</a></p><p><a href="mailto:booking@singaporemaxicabs.com.sg">booking@singaporemaxicabs.com.sg</a><br>Call: <a href="tel:+6588006006">+65 8800 6006</a><br>You can also reply to this email.</p>`,
  };
}

export async function sendPaidBookingEmail(store, mailer, id) {
  const booking = await store.getBooking(id);
  if (!booking || booking.status !== 'PAID' || booking.booking_status === 'CANCELLED') { return { skipped: true }; }
  mailer.assertReady();
  if (!await store.claimEmailConfirmation(booking.id)) {
    const existing = await store.getEmailConfirmation(booking.id);
    return { status: existing?.status ?? 'UNKNOWN', duplicate: true };
  }
  try {
    const messageId = await mailer.sendConfirmation(booking);
    await store.finishEmailConfirmation(booking.id, 'ACCEPTED', messageId);
    return { status: 'ACCEPTED' };
  } catch {
    await store.finishEmailConfirmation(booking.id, 'UNKNOWN', null);
    return { status: 'UNKNOWN' };
  }
}

export function bookingMailer({ host = process.env.SMTP_HOST ?? 'smtp.hostinger.com',
  port = Number(process.env.SMTP_PORT ?? 465), user = process.env.SMTP_USER ?? 'booking@singaporemaxicabs.com.sg',
  password = process.env.SMTP_PASSWORD, createTransport = nodemailer.createTransport } = {}) {
  let transport;
  return {
    assertReady() {
      if (!host || ![465, 587].includes(port) || !emailAddress(user) || !password) {
        throw Object.assign(new Error('Configure SMTP_HOST, SMTP_PORT (465 or 587), SMTP_USER and SMTP_PASSWORD.'), { code: 'EMAIL_NOT_CONFIGURED' });
      }
    },
    async sendConfirmation(booking) {
      this.assertReady();
      if (!emailAddress(booking.customer_email)) { throw new Error('Invalid stored customer email.'); }
      transport ??= createTransport({ host, port, secure: port === 465, requireTLS: port === 587,
        auth: { user, pass: password }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
        disableFileAccess: true, disableUrlAccess: true });
      const info = await transport.sendMail({ from: { name: 'Singapore Maxicabs', address: user },
        to: { name: booking.customer_name, address: booking.customer_email }, ...bookingEmailContent(booking) });
      if (!info.messageId || !info.accepted?.length) { throw new Error('SMTP acceptance could not be confirmed.'); }
      return info.messageId;
    },
  };
}

export function bookingEmailRoutes({ vehicleStore: store, adminApiKey, adminAuth, mailer }) {
  const router = Router();
  router.post('/bookings/:id/email-confirmation', requireAdmin(adminApiKey, adminAuth), async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|BK\d{11,})$/i.test(req.params.id) ||
      !req.body || Array.isArray(req.body) || Object.keys(req.body).length) {
      return sendError(req, res, 400, 'INVALID_INPUT', 'Use a booking UUID or booking number and an empty JSON object.');
    }
    try {
      const booking = await store.getBooking(req.params.id);
      if (!booking) { return sendError(req, res, 404, 'NOT_FOUND', 'Booking not found.'); }
      if (booking.booking_status === 'CANCELLED' || !(booking.status === 'PAID' ||
        (booking.payment_method === 'MANUAL' && booking.booking_status === 'CONFIRMED'))) {
        return sendError(req, res, 409, 'BOOKING_NOT_CONFIRMED', 'A paid booking or confirmed manual booking is required.');
      }
      if (!emailAddress(booking.customer_email)) { return sendError(req, res, 400, 'INVALID_INPUT', 'The stored customer email is invalid.'); }
      mailer.assertReady();
      if (!await store.claimEmailConfirmation(booking.id)) {
        const existing = await store.getEmailConfirmation(booking.id);
        if (existing?.status === 'ACCEPTED') {
          return res.json({ success: true, status: 'ACCEPTED', message_id: existing.message_id, duplicate: true });
        }
        return sendError(req, res, 409, 'EMAIL_SEND_UNCERTAIN', 'An email attempt already exists. Check SMTP delivery logs before any resend.');
      }
      try {
        const messageId = await mailer.sendConfirmation(booking);
        await store.finishEmailConfirmation(booking.id, 'ACCEPTED', messageId);
        return res.status(202).json({ success: true, status: 'ACCEPTED', message_id: messageId });
      } catch {
        await store.finishEmailConfirmation(booking.id, 'UNKNOWN', null);
        return sendError(req, res, 502, 'EMAIL_SEND_UNCERTAIN', 'Email acceptance could not be confirmed. Check SMTP delivery logs before any resend.');
      }
    } catch (err) {
      if (err.code === 'EMAIL_NOT_CONFIGURED') { return sendError(req, res, 503, err.code, err.message); }
      return next(err);
    }
  });
  return router;
}
