export function loadConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {throw new Error('PORT must be between 1 and 65535.');}
  const proxy = env.TRUST_PROXY || 'false';
  if (!['false', 'loopback'].includes(proxy)) {throw new Error('TRUST_PROXY must be false or loopback.');}
  if (!env.DATABASE_URL) {throw new Error('DATABASE_URL is required.');}
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {throw new Error('DATABASE_URL must use PostgreSQL.');}
  if (env.NODE_ENV === 'production' && (!env.ADMIN_API_KEY || env.ADMIN_API_KEY.length < 32)) {
    throw new Error('Production requires ADMIN_API_KEY with at least 32 characters.');
  }
  return {
    port, host: env.HOST || '127.0.0.1', databaseUrl: env.DATABASE_URL,
    adminApiKey: env.ADMIN_API_KEY, trustProxy: proxy === 'loopback' ? 'loopback' : false,
  };
}
