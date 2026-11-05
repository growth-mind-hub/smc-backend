# Recent API changes: app team handoff

Examples use Bash/curl syntax (also importable into Postman). Replace the backend host, IDs and token with actual values. JSON responses below are illustrative; booking and vehicle examples show selected fields only, and actual responses include additional fields. No requests in this document have been executed as part of preparing the handoff.

```bash
BASE_URL='https://YOUR_BACKEND_HOST'
TOKEN='YOUR_ADMIN_ACCESS_TOKEN'
```

All paths also work with `/api` instead of `/api/v1`.

| Feature | Method and path | Admin token |
| --- | --- | --- |
| Existing app checkout | POST `/api/v1/bookings/checkout` | No |
| Manual booking | POST `/api/v1/bookings` | Yes |
| List bookings | GET `/api/v1/bookings` | Yes |
| Update booking | PATCH `/api/v1/bookings/:id` | Yes |
| Delete booking | DELETE `/api/v1/bookings/:id` | Yes |
| Delete add-on | DELETE `/api/v1/add-ons/:id` | Yes |
| Deactivate add-on | PATCH `/api/v1/add-ons/:id` | Yes |
| Activate/deactivate fleet | PATCH `/api/v1/vehicles/:id` | Yes |
| Edit fleet description | PATCH `/api/v1/vehicles/:id` | Yes |
| Edit eight-hour rate | PUT `/api/v1/vehicles/:id/prices/hourly` | Yes |
| Read fleets and rates | GET `/api/v1/vehicles` | No |

Use an admin login access token in the admin panel; do not embed the server ADMIN_API_KEY in client code. JSON writes require Content-Type. DELETE requests need no body or Content-Type.

## Admin login

```bash
curl -X POST "$BASE_URL/api/v1/admin/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"YOUR_USERNAME","password":"YOUR_PASSWORD"}'
```

200 response contains `access_token`; use its value as TOKEN for the requests below.

## Existing app checkout: no authorization

```bash
curl -X POST "$BASE_URL/api/v1/bookings/checkout" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: app-checkout-example-001' \
  -d '{
    "customer":{"name":"John Smith","email":"john@example.com","phone":"+6591234567"},
    "vehicle_id":3,"service_id":1,
    "pickup":{"address":"Changi Airport Terminal 1"},
    "drop":{"address":"Marina Bay Sands"},
    "add_ons":[],"payment_method":"STRIPE"
  }'
```

200 example:

```json
{"success":true,"booking_id":"BK20261021001","payment_status":"PENDING","amount":80,"currency":"SGD","stripe_checkout_url":"https://checkout.stripe.com/..."}
```

Redirect the customer to `stripe_checkout_url`. The server calculates the amount; do not send prices. Hourly services require `hours`, for example `"hours":8`. IDs are examples: get actual services from GET `/api/v1/services` and vehicles from GET `/api/v1/vehicles`.

## Manual booking from admin

```bash
curl -X POST "$BASE_URL/api/v1/bookings" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: admin-manual-example-001' \
  -d '{
    "customer":{"name":"John Smith","email":"john@example.com","phone":"+6591234567"},
    "vehicle_id":3,"service_id":1,
    "pickup":{"address":"Changi Airport Terminal 1"},
    "drop":{"address":"Marina Bay Sands"},
    "add_ons":[{"add_on_id":2,"quantity":1}],
    "driver_name":"Driver Name","driver_phone":"9123 4567"
  }'
```

201 example (selected fields):

```json
{"booking":{"id":"a181390c-b26b-4718-a634-3edfdd3d3cbe","booking_number":"BK20261021002","payment_method":"MANUAL","booking_status":"CONFIRMED","status":"PENDING_PAYMENT","total_amount_minor":"10000","currency":"SGD","driver_name":"Driver Name","driver_phone":"9123 4567","stripe_checkout_url":null}}
```

No Stripe session is created. Rates and distance are calculated by the backend, requiring Google distance configuration. Driver fields are optional; send `add_ons: []` for none. Do not send payment_method, status, currency or amounts. Manual payment collection/marking paid and pickup scheduling are not implemented.

For both creation endpoints, use a new Idempotency-Key per booking attempt and reuse it only for retries with identical input. Manual booking retries return 200 and the existing booking; changed input returns 409 `IDEMPOTENCY_CONFLICT`. Keep keys distinct between app checkout and manual bookings. Starting-price fares cannot create bookings; contact-support routes return `CONTACT_SUPPORT` without creating a booking.

## List and update bookings

```bash
curl "$BASE_URL/api/v1/bookings?limit=50&offset=0" \
  -H "Authorization: Bearer $TOKEN"
```

200 response: `{ "bookings": [...] }`. Includes manual and app bookings, newest first. Each item is a booking object as illustrated above. Limit is 1–100.

```bash
curl -X PATCH "$BASE_URL/api/v1/bookings/BK20261021002" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"booking_status":"COMPLETED"}'
```

200 example (selected fields):

```json
{"booking":{"booking_number":"BK20261021002","booking_status":"COMPLETED","status":"PENDING_PAYMENT","payment_method":"MANUAL"}}
```

Operational booking statuses: NEW, CONFIRMED, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED. This endpoint also accepts driver_name and driver_phone. Payment `status` is independent and cannot be changed here. UUIDs or booking numbers work for booking detail/update/delete. GET `/api/v1/bookings/:id` returns `{ "booking": {...} }`.

## Delete a booking

```bash
curl -i -X DELETE "$BASE_URL/api/v1/bookings/BK20261021002" \
  -H "Authorization: Bearer $TOKEN"
```

204 No Content; empty response body. Missing booking: 404. Permanently removes the booking, its add-on snapshots and webhook receipts. Does not refund payments or expire Stripe sessions. A pending Stripe session may still accept payment after deletion; later webhooks are ignored. Deletion frees its idempotency key, so a checkout retry can create a new booking.

## Delete an add-on

```bash
curl -i -X DELETE "$BASE_URL/api/v1/add-ons/2" \
  -H "Authorization: Bearer $TOKEN"
```

204 No Content; empty response body. Allowed when unused or all linked bookings have operational status COMPLETED. Historical add-on names, quantities and prices remain; their add_on_id becomes null. Other statuses, including CANCELLED, block deletion. PAID alone does not qualify.

409 example:

```json
{"error":{"code":"ADD_ON_IN_USE","message":"This add-on is used by bookings that are not COMPLETED. Set its status to INACTIVE instead."},"requestId":"example-request-id"}
```

Deactivate instead:

```bash
curl -X PATCH "$BASE_URL/api/v1/add-ons/2" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"INACTIVE"}'
```

200 example (selected fields):

```json
{"success":true,"add_on":{"id":2,"code":"MEET_GREET","name":"Arrival Meet & Greet","price":20,"status":"INACTIVE"}}
```

Use `ACTIVE` to reactivate. Inactive add-ons are excluded from GET `/api/v1/add-ons` and new quotes.

## Deactivate and activate fleet vehicles

Deactivate:

```bash
curl -X PATCH "$BASE_URL/api/v1/vehicles/3" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"inactive"}'
```

200 example (selected fields):

```json
{"vehicle":{"id":3,"name":"Toyota Alphard / Vellfire","status":"inactive","isActive":false}}
```

Activate:

```bash
curl -X PATCH "$BASE_URL/api/v1/vehicles/3" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"active"}'
```

200 example (selected fields):

```json
{"vehicle":{"id":3,"name":"Toyota Alphard / Vellfire","status":"active","isActive":true}}
```

Vehicle status is lowercase; add-on status is uppercase. GET /api/v1/vehicles includes active and inactive vehicles with status and isActive fields. Inactive vehicles cannot be recommended or used for new quotes. The recommendation endpoint returns active vehicles only. Existing bookings remain. To fetch a vehicle directly, use GET `/api/v1/vehicles/:id`.

## Fleet description

```bash
curl -X PATCH "$BASE_URL/api/v1/vehicles/3" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"description":"The Toyota Alphard / Vellfire is a six-seater executive MPV for families and small groups. Travel together for airport transfers, business trips or private journeys around Singapore."}'
```

200 example (selected fields):

```json
{"vehicle":{"id":3,"description":"The Toyota Alphard / Vellfire is a six-seater executive MPV for families and small groups. Travel together for airport transfers, business trips or private journeys around Singapore."}}
```

Add a Description textarea to create/edit forms; maximum 1000 characters. The existing POST `/api/v1/vehicles` also accepts description alongside its required vehicle and price fields. Omit description to preserve it on PATCH; empty string clears it. Render as plain text.

## Eight-hour rates

```bash
curl "$BASE_URL/api/v1/vehicles"
```

200 example (selected fields):

```json
{"success":true,"requirements":null,"data":[{"id":3,"name":"Toyota Alphard / Vellfire","description":"The Toyota Alphard / Vellfire is a six-seater executive MPV for families and small groups. Travel together for airport transfers, business trips or private journeys around Singapore.","prices":{"hourly":{"amount":60,"eightHourAmount":480,"currency":"SGD"}},"recommendation":false}]}
```

Use `data[].prices.hourly.eightHourAmount`, not `eight_hour_amount`. It is the complete eight-hour package amount. `amount` is the per-hour rate. GET `/api/v1/vehicles/:id` wraps the same vehicle under `vehicle`. `/vehicles/minimum-prices` does not return full prices.

Update the hourly price and package amount:

```bash
curl -X PUT "$BASE_URL/api/v1/vehicles/3/prices/hourly" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"amount":60,"eightHourAmount":480,"currency":"SGD","minimumHours":3}'
```

200 example (selected fields):

```json
{"vehicle":{"id":3,"prices":{"hourly":{"amount":60,"eightHourAmount":480,"currency":"SGD","minimumHours":3}}}}
```

PUT requires amount; include other price settings you want to retain (such as minimumHours, isFrom, validity dates and status). Omitted eightHourAmount/threeHourAmount are preserved for existing rows; other omitted settings can reset to their defaults. Changing the hourly rate does not automatically recalculate an existing eight-hour package. The current quote/checkout calculation multiplies hourly rate by hours; it does not select eightHourAmount as a separate package price.

## Errors and deployment

Common errors: 400 invalid input; 401 invalid/missing admin token; 404 missing record; 409 conflicts; 415 missing JSON Content-Type; 503 missing payment/distance/admin configuration or unavailable external service.

Example 404:

```json
{"error":{"code":"NOT_FOUND","message":"Booking not found."},"requestId":"example-request-id"}
```

Deployment: apply migrations with `npm run db:migrate` and restart the backend. Review pending migrations before running on production: earlier fleet migrations can update prices/capacities.

| Migration | Purpose |
| --- | --- |
| 018 | Delete add-ons used only by completed bookings; preserve snapshots |
| 019 | MANUAL booking payment method |
| 020 | Fill blank fleet descriptions |
| 021 | Fill null eight-hour rates as hourly × 8; preserve existing rates |
| 022 | Expand the six original short descriptions; preserve later admin edits |

Database updates already verified in the configured database during this work: five missing eight-hour rates and six short descriptions. This does not confirm that a separate live environment has applied all migrations or deployed the new API code.

## Send WhatsApp booking confirmation

POST `/api/v1/bookings/:id/whatsapp-confirmation` (also under `/api`). Requires admin bearer authentication, JSON body `{"whatsapp_opt_in":true}`, and migration 023. Send only after obtaining customer consent. The recipient and five approved template parameters come from the stored booking. Paid bookings and confirmed manual bookings are eligible; cancelled bookings are rejected.

Returns 202 with `status: ACCEPTED` and `message_id` when Meta accepts the message; this does not confirm delivery. Repeat calls return the original message ID without sending again. Uncertain sends require operator review before any resend. The API is explicitly triggered; Stripe payment events do not automatically send WhatsApp messages. No Meta delivery webhook is included.

See [WhatsApp integration and setup](whatsapp-api.md) for required server environment variables, template order, responses and recovery limitations.
