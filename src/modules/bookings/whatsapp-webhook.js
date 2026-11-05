import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { sendError } from '../../middleware/errors.js';

export function whatsappWebhook({ vehicleStore, verifyToken = process.env.WHATSAPP_VERIFY_TOKEN,
  appSecret = process.env.WHATSAPP_APP_SECRET }) {
  return {
    verify(req, res) {
      res.setHeader('Cache-Control', 'no-store');
      if (!verifyToken) { return sendError(req, res, 503, 'WHATSAPP_NOT_CONFIGURED', 'Configure WHATSAPP_VERIFY_TOKEN.'); }
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      if (mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string' || !challenge || challenge.length > 1024 ||
        !timingSafeEqual(createHash('sha256').update(token).digest(), createHash('sha256').update(verifyToken).digest())) {
        return sendError(req, res, 403, 'INVALID_VERIFY_TOKEN', 'Webhook verification failed.');
      }
      return res.status(200).type('text/plain').send(challenge);
    },
    async receive(req, res, next) {
      res.setHeader('Cache-Control', 'no-store');
      if (!appSecret) { return sendError(req, res, 503, 'WHATSAPP_NOT_CONFIGURED', 'Configure WHATSAPP_APP_SECRET.'); }
      const signature = req.get('X-Hub-Signature-256');
      if (!Buffer.isBuffer(req.body) || !/^sha256=[a-f0-9]{64}$/i.test(signature ?? '')) {
        return sendError(req, res, 401, 'INVALID_SIGNATURE', 'Invalid Meta webhook signature.');
      }
      const expected = createHmac('sha256', appSecret).update(req.body).digest();
      if (!timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) {
        return sendError(req, res, 401, 'INVALID_SIGNATURE', 'Invalid Meta webhook signature.');
      }
      let payload;
      try { payload = JSON.parse(req.body.toString('utf8')); }
      catch { return sendError(req, res, 400, 'INVALID_JSON', 'Send a valid JSON webhook payload.'); }
      if (!payload || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
        return sendError(req, res, 400, 'INVALID_INPUT', 'Expected a WhatsApp Business Account webhook event.');
      }
      try {
        // Persist before acknowledging so a database failure can be retried by Meta.
        await vehicleStore.saveWhatsappWebhook(createHash('sha256').update(req.body).digest('hex'), payload);
        return res.json({ received: true });
      } catch (err) { return next(err); }
    },
  };
}
