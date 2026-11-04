import { createHash, randomBytes } from 'node:crypto';
import { sendError } from './errors.js';

const digest = value => createHash('sha256').update(value).digest();

export function adminLogin({ authenticate, now = Date.now }) {
  const sessions = new Map();
  const refreshTokens = new Map();
  const expiresIn = 3600;
  const refreshExpiresIn = 7 * 24 * 3600;
  const prune = () => {
    for (const [key, expiry] of sessions) {
      if (expiry <= now()) { sessions.delete(key); }
    }
    for (const [key, session] of refreshTokens) {
      if (session.expiry <= now()) { refreshTokens.delete(key); }
    }
  };
  const issue = (res, expiry = now() + refreshExpiresIn * 1000) => {
    prune();
    if (sessions.size >= 1000) { sessions.delete(sessions.keys().next().value); }
    if (refreshTokens.size >= 1000) { refreshTokens.delete(refreshTokens.keys().next().value); }
    const token = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    const accessKey = digest(token).toString('hex');
    sessions.set(accessKey, now() + expiresIn * 1000);
    refreshTokens.set(digest(refreshToken).toString('hex'), { expiry, accessKey });
    return res.json({ access_token: token, refresh_token: refreshToken, token_type: 'Bearer',
      expires_in: expiresIn, refresh_expires_in: Math.ceil((expiry - now()) / 1000) });
  };
  return {
    configured: typeof authenticate === 'function',
    verify(token) {
      prune();
      return typeof token === 'string' && token.startsWith('Bearer ')
        && sessions.has(digest(token.slice(7)).toString('hex'));
    },
    async login(req, res) {
      res.setHeader('Cache-Control', 'no-store');
      if (typeof authenticate !== 'function') {
        return sendError(req, res, 503, 'ADMIN_NOT_CONFIGURED', 'Admin login requires a configured admin database.');
      }
      if (!req.is('application/json')) {
        return sendError(req, res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send Content-Type: application/json.');
      }
      const body = req.body;
      if (!body || typeof body.username !== 'string' || typeof body.password !== 'string'
        || !body.username || !body.password || body.username.length > 100 || body.password.length > 1024
        || Object.keys(body).some(key => !['username', 'password'].includes(key))) {
        return sendError(req, res, 400, 'INVALID_INPUT', 'Send username and password as nonempty strings.');
      }
      const user = await authenticate(body.username, body.password);
      if (!user) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Invalid admin credentials.');
      }
      return issue(res);
    },
    refresh(req, res) {
      res.setHeader('Cache-Control', 'no-store');
      if (!req.is('application/json')) {
        return sendError(req, res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Send Content-Type: application/json.');
      }
      const body = req.body;
      if (!body || typeof body.refresh_token !== 'string' || !body.refresh_token
        || body.refresh_token.length > 1024 || Object.keys(body).some(key => key !== 'refresh_token')) {
        return sendError(req, res, 400, 'INVALID_INPUT', 'Send refresh_token as a nonempty string.');
      }
      prune();
      const key = digest(body.refresh_token).toString('hex');
      const session = refreshTokens.get(key);
      if (!session) {
        return sendError(req, res, 401, 'UNAUTHORIZED', 'Invalid or expired refresh token.');
      }
      refreshTokens.delete(key);
      sessions.delete(session.accessKey);
      return issue(res, session.expiry);
    },
  };
}
