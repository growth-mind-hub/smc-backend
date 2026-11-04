# Booking management

Run `npm run db:migrate` to apply migrations 011 and 012, then restart the API.
All endpoints require `Authorization: Bearer <access_token>` from admin login.
The existing server-side admin API key is also accepted.
Both `/api/v1` and `/api` prefixes work.

## Manual booking

Apply migration 019 with `npm run db:migrate` and restart the backend.
`POST /api/v1/bookings` (also `/api/bookings`) creates an admin booking without a Stripe session. Requires admin authentication and JSON. Prices come from the active catalog, add-ons and Google driving distance, using the same quote rules as checkout. Starting-price fares and contact-support routes cannot create bookings. Google distance configuration is still required; Stripe configuration is not.

```json
{
  "customer": { "name": "John Smith", "email": "john@example.com", "phone": "+6591234567" },
  "vehicle_id": 3,
  "service_id": 1,
  "pickup": { "address": "Changi Airport Terminal 1" },
  "drop": { "address": "Marina Bay Sands" },
  "add_ons": [],
  "driver_name": "Driver Name",
  "driver_phone": "9123 4567"
}
```

Use real vehicle/service IDs. Hourly services require `hours`. Driver fields are optional plain text. Do not send prices, payment_method, or status. Returns 201 `{ "booking": {...} }` with the generated booking number, `payment_method: "MANUAL"`, `booking_status: "CONFIRMED"` and payment `status: "PENDING_PAYMENT"`. It appears in existing admin booking lists. Creation records no payment and does not send a payment link. Manual payment collection/marking paid and pickup scheduling are not provided by this endpoint.

Send an `Idempotency-Key` header for safe retries. Identical retries return 200 with the existing booking; changed details or reuse of an app checkout key return 409. If omitted, the server generates and returns the key in the response header. Store it before retrying. The booking and add-on snapshots are saved in one transaction.

`DELETE /api/v1/bookings/:id` permanently deletes a booking and its add-on snapshots and webhook receipts. Accepts a UUID or booking number; returns 204 with no body, or 404 if missing. No request body or Content-Type header is required. This does not refund payments or expire Stripe Checkout sessions; a pending session may still accept payment after deletion. Later webhooks for a deleted booking are ignored. Deletion also removes its idempotency key, so retrying checkout with that key can create a new booking.

- `GET /api/v1/bookings?limit=50&offset=0` returns `{ "bookings": [...] }`, newest first. Limit is 1–100, default 50.
- `GET /api/v1/bookings/:id` returns `{ "booking": {...} }`. Use the UUID or booking number.
- `PATCH /api/v1/bookings/:id` updates operational status and/or driver details and returns `{ "booking": {...} }`.

Send `Content-Type: application/json` for PATCH:

```json
{
  "booking_status": "ASSIGNED",
  "driver_name": "Driver Name",
  "driver_phone": "9123 4567"
}
```

Operational statuses: `NEW`, `CONFIRMED`, `ASSIGNED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`.
`status` remains the Stripe payment status and cannot be edited by this endpoint.
`driver_name` and `driver_phone` are plain-text columns. Phone text may include spaces or local formatting. Send an empty string to clear either field. Omitted fields stay unchanged.
Migration 012 converts existing driver lists to comma-separated text before removing the JSON column.
Missing bookings return 404, invalid input 400, invalid/missing tokens 401, and missing JSON content type 415.
