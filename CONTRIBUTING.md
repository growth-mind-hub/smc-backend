# Developer guide

## Project structure

| Location | Responsibility |
| --- | --- |
| `src/server.js` | Validate configuration, connect to PostgreSQL, start and stop HTTP server |
| `src/app.js` | Assemble middleware, health endpoints and feature routes |
| `src/config/env.js` | Validate environment variables without exposing credentials |
| `src/database/pool.js` | Connection pooling, connection limits and query timeouts |
| `src/modules/vehicles/vehicle.routes.js` | Map URLs to controllers |
| `src/modules/vehicles/vehicle.controller.js` | Authenticate requests, validate input and produce HTTP responses |
| `src/modules/vehicles/vehicle.validation.js` | Validate payloads using database service definitions |
| `src/modules/vehicles/vehicle.repository.js` | Parameterized PostgreSQL queries and atomic writes |
| `src/modules/bookings/` | Checkout validation, booking price snapshots, Stripe sessions and verified webhook updates |
| `src/middleware/errors.js` | Consistent errors and safe logging |
| `scripts/` and `db/` | Explicit migration and initial data setup |
| `test/` | API, configuration and PostgreSQL integration tests |

Request flow: route → controller → validation/repository → PostgreSQL → JSON response.
The vehicle APIs never read files. Migration scripts alone read SQL files.
Import vehicle repositories and validation directly from `src/modules/vehicles/`.

## Local setup

1. Install Node.js 22.13+ and PostgreSQL.
2. Run `npm ci` and copy `.env.example` to `.env`.
3. Create the `maxicab` database and configure `DATABASE_URL`.
4. Configure `ADMIN_API_KEY`; production requires at least 32 characters.
5. Run `npm run db:migrate`, then `npm run dev`.
6. Check `GET /health` and `GET /ready`.

Migrations are separate from API startup. Run them with an account permitted to create tables, indexes and functions. The API database account needs SELECT/INSERT/UPDATE access to services, vehicles and prices, plus access to the vehicle identity sequence. It does not need schema creation privileges.

## Adding or changing behavior

Keep SQL in repositories, payload rules in validation, and HTTP handling in controllers. Use parameterized SQL and put related writes in one transaction. Service codes and billing units come from `services`; do not introduce a JavaScript service list. Do not edit migrations that have already been deployed; add a new version and register it in the migration runner.

Keep existing response fields stable. Record API changes in README and add tests for observable behavior. Do not commit `.env`, credentials or database exports.

Recommendations use the PostgreSQL catalog and configured passenger/luggage capacities. Confirm capacities against actual vehicle layouts and bag sizes before launch.

## Tests

Run `npm run lint` before committing. ESLint checks all JavaScript files in source, scripts, tests and configuration, and rejects warnings. Run `npm run lint:fix` to apply safe automatic fixes. `npm run check` runs linting followed by tests. Rules enforce the recommended correctness checks, block-scoped variables, strict equality, explicit braces and safe promise/error patterns. Node globals such as `console` and `process` are allowed for this backend.

`npm test` runs tests without a database. PostgreSQL tests are skipped unless `TEST_DATABASE_URL` is set. For complete verification, point that variable to a dedicated test database, then run `npm test`. These tests create and drop an isolated schema and check seeding, duplicates, persistence and transactions.

## Deployment

Run migrations before starting the new application version. Set `NODE_ENV=production`, a strong `ADMIN_API_KEY`, and `DATABASE_URL`. Keep the admin key in your authenticated dashboard server; never include it in browser JavaScript. This API key authenticates a server integration; the app does not implement dashboard user login or roles.

Run the application under a service manager with automatic restart, behind an HTTPS reverse proxy. When a local reverse proxy is the only ingress, use `TRUST_PROXY=loopback`. Probe `/health` for process liveness and `/ready` for database connectivity. Shutdown drains HTTP requests and closes the database pool, with a ten-second deadline.

The database pool supports ten connections per application process; account for all instances when sizing PostgreSQL. Rate limits are held in process memory; use proxy or shared rate limiting for multiple instances. Use provider-supported TLS for remote PostgreSQL connections. Back up PostgreSQL and verify restoration. Run database integration tests and expected-traffic load tests before deployment.
