# Catalog API

The schema has been upgraded: see [current database design](database-design.md). The price table is now `vehicle_service_prices`, services have numeric IDs, and currency is stored per price. Migration 005 preserves existing catalog IDs. Vehicle types, images, statuses and price validity dates are supported.

## Tables and relationships

| Table | Data | Key |
| --- | --- | --- |
| `vehicles` | Name, description, type, capacities, image and status | `id` |
| `services` | Category code, display name, billing unit, order | `code` |
| `vehicle_service_prices` | Decimal price, currency, status, validity dates and hourly minimum | `id` (unique vehicle_id/service_id) |

Each price references one vehicle and one service. The same service can have different prices for different vehicles. Run migration 005 to upgrade existing tables.

## Homepage

Every price now includes a stable `catalogId` identifying that exact vehicle/service pair. For example, a vehicle can return `"prices": { "arrival": { "catalogId": 12, "amount": 95, ... } }`. The frontend sends `{"catalogId":12}` with the remaining booking details. `GET /api/v1/catalog/12` resolves the selection to its vehicle, currency, service and current price. Vehicle ID alone does not identify the selected service.

The ID stays unchanged when an admin updates the price. It identifies the catalog selection, not a locked quote. The future booking API must look up this ID server-side, validate the selection and save the agreed amount/currency as a booking snapshot. Do not trust a price submitted by the frontend. This application does not yet implement booking persistence.

Run `npm run db:migrate` to apply `003-catalog-id.sql`. It assigns IDs to existing prices without replacing their amounts. Grant the API role USAGE on the new `vehicle_service_prices` identity sequence as well as the existing vehicle sequence.

`GET /api/v1/vehicles` joins the three tables. Each vehicle's `prices` object is keyed by service code. Each price includes `amount`, `amountMinor`, `serviceName`, `unit`, `isFrom` and `minimumHours`. The frontend can render `Object.entries(vehicle.prices)` and format amounts with the vehicle's currency. It should show `From` for starting prices, `/hr` for hourly units, and minimum hours when present.

`GET /api/v1/services` supplies dashboard selectors. `GET /api/v1/vehicles/:id` returns a single combined vehicle. Services with no vehicle price do not appear in that vehicle's prices; do not display them as free. Refetch after an update to display changes.

## Admin endpoints

All writes require JSON and `Authorization: Bearer <token>`. Browser dashboards obtain a session token through [admin login](admin-login.md). Server clients may use `ADMIN_API_KEY`; keep that key on the backend.

| Endpoint | Example JSON body |
| --- | --- |
| `POST /api/v1/vehicles` | Existing README creation example, with prices for every database service |
| `PATCH /api/v1/vehicles/:id` | `{"name":"Mercedes V-Class Executive","passengerCapacity":7}` |
| `POST /api/v1/services` | `{"code":"city_tour","name":"City Tour","unit":"hour","sortOrder":4}` |
| `PATCH /api/v1/services/:code` | `{"name":"Private City Tour","sortOrder":5}` |
| `PUT /api/v1/vehicles/:id/prices/:service` | `{"amount":88,"isFrom":false,"minimumHours":3}` |

PUT sets or replaces one category price and returns the combined vehicle. For example, `/api/v1/vehicles/1/prices/arrival` with `{"amount":95}` changes only vehicle 1's arrival rate. Other prices stay unchanged. Amount is required. Omitted `isFrom` becomes false and omitted `minimumHours` becomes null. Hourly minimums only apply to hourly services. Amounts must be nonnegative with at most two decimal places.

Vehicle PATCH updates supplied fields only: name, description and passenger capacity (which may be null). Currency is stored per price and can be updated through price PUT. Service codes and billing units remain fixed after creation; admins can change names and order. Adding a service does not invent rates for existing vehicles: configure each rate using PUT. New vehicle creation requires prices for all database services.

Errors: 400 invalid input, 401 unauthorized, 404 missing record, 409 duplicate name/code, 503 admin key not configured. Concurrent price edits use the last committed value; edit history and version checks are not implemented.

## Setup and verification

Run `npm run db:migrate` before starting a new database. The API only queries PostgreSQL. Existing records are preserved. The API database role requires SELECT/INSERT/UPDATE on vehicles, services and vehicle_service_prices, plus USAGE on the vehicle identity sequence. Use a separate role for migrations.

Run `npm run check`. Set `TEST_DATABASE_URL` to a dedicated PostgreSQL test database to verify persistence and joined responses with the real database.
# Admin fleet descriptions

The admin panel can include an optional Description textarea in both Create Fleet and Edit Fleet forms. Send its value as `description` with `POST /api/v1/vehicles` or `PATCH /api/v1/vehicles/:id`, using the admin Bearer token. The field accepts plain text up to 1000 characters and is returned as `vehicle.description` (or `data[].description` in fleet lists). Populate the edit field from the existing description; omit it when not editing it, or send an empty string to clear it. Render descriptions as text.

Example PATCH body:

```json
{
  "description": "The Toyota Alphard / Vellfire is an MPV option for families and small groups. Travel together for airport transfers or journeys around Singapore."
}
```

Migration 020 fills blank fleet descriptions with two sentences based on the vehicle name. Existing nonblank descriptions are preserved. Apply it with `npm run db:migrate`; it runs once, so later admin edits are retained.

