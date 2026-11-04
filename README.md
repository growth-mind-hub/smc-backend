# Maxicab recommendation API

Express API with a persistent PostgreSQL vehicle pricing catalog, server-calculated quotes, booking price snapshots and Stripe Checkout. Recommendations use the PostgreSQL vehicle catalog and configured passenger/luggage capacities. The API does not check live availability or reserve fleet inventory.

## Run

Use Node.js 22 or newer and a running PostgreSQL database.

```bash
npm ci
# Copy .env.example to .env if .env is missing.
npm run db:migrate
npm start
```

Run `npm test` for API tests; `npm run dev` for watch mode. Set `TEST_DATABASE_URL` to a dedicated PostgreSQL test database to also run database integration tests. Those tests create and remove an isolated schema and require schema creation privileges; without this variable, they are skipped.

## API

Share the [browser-readable frontend API handoff](docs/frontend-api-handoff.html), [Markdown reference](docs/frontend-api-handoff.md) and [Postman collection](docs/maxicab-api.postman_collection.json) with the frontend team. The handoff covers all current requests, response examples, validation, authentication, quote/checkout flow, errors and browser integration limitations. The HTML document is self-contained and can be printed to PDF.

See the [current database design](docs/database-design.md) for the four-table schema and migration 005.

For the database-backed homepage flow, see [homepage API](docs/homepage-api.md): `GET /api/vehicles` and `GET /api/vehicles/recommend?persons=4&luggage=3`.

For optional extras and server-calculated totals, see [add-ons and quote API](docs/add-ons-api.md). Migration 007 adds the five supplied add-ons. Public clients use `GET /api/add-ons` and `POST /api/booking/quote`; admin clients can create and update add-ons.

Quotes now require `pickup` and `drop` address objects. Migration 008 adds configurable distance surcharges. Set the server's `GOOGLE_MAPS_API_KEY` with Google Distance Matrix API (Legacy) enabled to retrieve driving distances. Routes over 35 km return `CONTACT_SUPPORT` without a total; available quotes add the distance charge to the vehicle fare and extras.

For confirmation and payment, see [booking checkout](docs/checkout-api.md): `POST /api/bookings/checkout` accepts customer information, route and IDs, recalculates prices and returns a Stripe Checkout URL. Migration 009 creates booking/payment snapshot tables. Configure Stripe secret key, webhook secret and frontend redirect URLs. Clients must not send `amount` or `currency`. Use `Idempotency-Key` to retry an attempt safely.

### Vehicle pricing for the frontend and dashboard

See the [catalog API guide](docs/catalog-api.md) for admin vehicle/service/price updates and the combined homepage response.

Create a PostgreSQL database named `maxicab` and set `DATABASE_URL` in `.env` (see `.env.example`). Run `npm run db:migrate` before starting the API. During this separate setup step, `db/001-vehicles.sql` creates the tables, and `db/002-services.sql` creates the services table. `db/seed-fleet.sql` inserts the 10 supplied vehicles exactly once. Existing fleet records are preserved. Seed currency is assumed to be SGD based on the Changi references. Unknown seating capacities are null. No luggage capacities are invented; the VIP seating/baggage arrangement is retained in its description.

Database design: `vehicles` stores ID, unique case-insensitive name, description, optional passenger capacity, currency and creation timestamp. `vehicle_service_prices` stores one row per vehicle/service, with a composite primary key, foreign key, integer cents, a starting-price flag and optional hourly minimum. Both vehicle and price insertion are one transaction. `schema_migrations` tracks seed initialization.

- `GET /api/v1/vehicles` returns `{ "success": true, "requirements": null, "data": [...] }` for frontend pricing cards. The duplicate `vehicles` array has been removed; list and recommendation clients should use `data`.
- `GET /api/v1/vehicles/:id` returns `{ "vehicle": {...} }` or 404.
- `POST /api/v1/vehicles` creates a vehicle and its three rates, returning 201 with `{ "vehicle": {...} }` and a Location header.

For browser dashboards, use [admin login](docs/admin-login.md) to obtain a one-hour Bearer token with username and password. Server clients can still set `ADMIN_API_KEY` in `.env` and send `Authorization: Bearer <ADMIN_API_KEY>`. Keep the API key on the server. Public catalog GET requests require no key. Cross-origin frontends must use an allowed CORS origin.

POST JSON example:

```json
{
  "name": "New Executive MPV",
  "description": "Executive MPV for 6 passengers",
  "passengerCapacity": 6,
  "currency": "SGD",
  "prices": {
    "arrival": { "amount": 90, "isFrom": false },
    "departure_transfer": { "amount": 80 },
    "hourly": { "amount": 70, "minimumHours": 3 }
  }
}
```

All services currently configured in the database are required. `GET /api/v1/services` returns their code, display name and billing unit for dashboard forms. Fleet names, prices and service definitions are read from PostgreSQL; JavaScript contains no fleet or service list. Amounts must be nonnegative with at most two decimal places. GET includes `amount`, `amountMinor` (cents), `isFrom`, `unit` (`trip` or `hour`) and `minimumHours` for every price. The 40-seater arrival is marked `isFrom: true`; the wheelchair vehicle has `minimumHours: 3`. Other hourly minimums are unspecified (null).

POST errors: 400 invalid data, 401 invalid admin credentials, 409 duplicate vehicle name, 503 missing admin configuration. Existing body-size and rate limits apply. Use PostgreSQL backup tooling such as `pg_dump`. Multiple application servers can share the same database. Explicit migration and seed initialization are serialized with a PostgreSQL advisory lock. Existing SQLite records are not automatically imported.

The legacy sample POST `/api/v1/cab-recommendations` endpoint has been removed. Use GET `/api/v1/vehicles/recommend?persons=4&luggage=3` for catalog recommendations.

## Deployment

See [CONTRIBUTING.md](CONTRIBUTING.md) for architecture, developer onboarding, testing and deployment details. Production startup requires an `ADMIN_API_KEY` of at least 32 characters. `GET /ready` checks database connectivity; `GET /health` checks process health.

Place Nginx with HTTPS in front of the app. Default bind is localhost. Set NODE_ENV=production. If Nginx on the same machine is the sole ingress, set TRUST_PROXY=loopback and prevent direct public access to Node. The limiter allows 120 API requests per minute per IP and uses process memory: for multiple processes/servers use a shared rate-limit store or enforce global limits at the proxy. Tune thresholds for shared client IPs. Logs omit input bodies and credentials.

Run under a service manager, configure monitoring, and load-test expected peak requests before launch. Graceful termination drains requests for up to 10 seconds. This starter includes production safeguards, but capacity and deployment security require validation in your actual environment.

The API never reads SQL or seed files. `npm start` only connects to PostgreSQL and queries existing tables. Use `npm run db:migrate` separately to prepare a new database or apply schema changes.
