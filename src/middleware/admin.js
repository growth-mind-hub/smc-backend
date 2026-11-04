import { createHash, timingSafeEqual } from 'node:crypto';
import { sendError } from './errors.js';

export function requireAdmin(adminApiKey, adminAuth, { requireJson = true } = {}) {
  const hash = value => createHash('sha256').update(value).digest();
  return (req, res, next) => {
    if (!adminApiKey && !adminAuth?.configured) {
      return sendError(req, res, 503, 'ADMIN_NOT_CONFIGURED', 'Configure admin login credentials or ADMIN_API_KEY to enable admin access.');
    }
    const token = req.get('Authorization');
    const validKey = adminApiKey && token && timingSafeEqual(hash(token), hash(`Bearer ${adminApiKey}`));
    if (!validKey && !adminAuth?.verify(token)) {
      return sendError(req, res, 401, 'UNAUTHORIZED', 'Valid admin credentials are required.');
    }
    if (requireJson && !['GET', 'HEAD'].includes(req.method) && !req.is('application/json')) {
      return sendError(req, res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send Content-Type: application/json.');
    }
    next();
  };
}
