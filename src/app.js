import express from 'express';
import { resolve } from 'node:path';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { vehicleRoutes } from './modules/vehicles/vehicle.routes.js';
import { addOnRoutes } from './modules/add-ons/add-on.routes.js';
import { googleDistanceProvider } from './modules/add-ons/google-routes.js';
import { checkoutRoutes, stripeWebhook } from './modules/bookings/checkout.routes.js';
import { stripePaymentProvider } from './modules/bookings/stripe-payment.js';
import { sendError as error, errorHandler } from './middleware/errors.js';
import { adminLogin } from './middleware/admin-login.js';
import { bookingAdminRoutes } from './modules/bookings/admin.routes.js';

export function createApp({
  vehicleUploadDir = process.env.VEHICLE_UPLOAD_DIR ?? '/var/lib/maxicab/uploads/vehicles',
  rateLimitMax = 120,
  logger = console,
  trustProxy = false,
  vehicleStore,
  adminApiKey = process.env.ADMIN_API_KEY,
  distanceProvider = googleDistanceProvider(),
  paymentProvider = stripePaymentProvider(),
} = {}) {
  if (!vehicleStore) {
    throw new Error('vehicleStore is required; initialize PostgreSQL first.');
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-ID', req.requestId);
    const start = performance.now();

    res.on('finish', () => logger.info(JSON.stringify({
      requestId: req.requestId,
      method: req.method,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - start),
    })));

    next();
  });

  // Add more frontend origins to this list when needed.
  app.use(cors({
    origin: [
      'https://singapore-maxicabs.vercel.app',
      'https://www.singaporemaxicabs.com.sg',
      'https://admin-smc.vercel.app',
    ],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(helmet());
  app.use('/uploads/vehicles', express.static(resolve(vehicleUploadDir), { dotfiles: 'deny', index: false, fallthrough: true, setHeaders: res => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin') }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/ready', async (req, res) => {
    try {
      await vehicleStore.ready();
      res.json({ status: 'ready' });
    } catch {
      error(req, res, 503, 'NOT_READY', 'Database is unavailable.');
    }
  });

  app.use('/api', rateLimit({
    windowMs: 60000,
    limit: rateLimitMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => error(
      req, res, 429, 'RATE_LIMITED', 'Too many requests. Try again shortly.',
    ),
  }));

  // Stripe signatures require the untouched body before the JSON parser.
  app.post(
    ['/api/payments/stripe/webhook', '/api/v1/payments/stripe/webhook'],
    express.raw({ type: 'application/json', limit: '64kb' }),
    stripeWebhook({ vehicleStore, paymentProvider }),
  );

  app.use(express.json({ limit: '10kb', strict: true }));

  const adminAuth = adminLogin({ authenticate: vehicleStore.authenticateAdmin });
  app.post(['/api/admin/login', '/api/v1/admin/login'], rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => error(req, res, 429, 'RATE_LIMITED', 'Too many login attempts. Try again later.'),
  }), adminAuth.login);
  app.post(['/api/admin/refresh', '/api/v1/admin/refresh'], adminAuth.refresh);

  app.use('/api/v1', vehicleRoutes({ vehicleStore, adminApiKey, adminAuth, vehicleUploadDir, logger }));
  app.use('/api', vehicleRoutes({ vehicleStore, adminApiKey, adminAuth, vehicleUploadDir, logger }));
  app.use('/api/v1', addOnRoutes({
    vehicleStore, adminApiKey, adminAuth, distanceProvider,
  }));
  app.use('/api', addOnRoutes({
    vehicleStore, adminApiKey, adminAuth, distanceProvider,
  }));
  app.use('/api/v1', checkoutRoutes({
    vehicleStore, distanceProvider, paymentProvider, logger,
  }));
  app.use('/api', checkoutRoutes({
    vehicleStore, distanceProvider, paymentProvider, logger,
  }));
  app.use('/api/v1', bookingAdminRoutes({ vehicleStore, adminApiKey, adminAuth, distanceProvider }));
  app.use('/api', bookingAdminRoutes({ vehicleStore, adminApiKey, adminAuth, distanceProvider }));

  app.use((req, res) => error(
    req, res, 404, 'NOT_FOUND', 'Endpoint not found.',
  ));

  app.use(errorHandler(logger));
  return app;
}
