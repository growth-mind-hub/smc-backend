# Add-ons and quotes

Run `npm run db:migrate` to apply migrations 007 and 008. They create PostgreSQL `add_ons` and `distance_pricing_rules` and seed the supplied SGD rates once. Later migration runs do not overwrite admin edits. Set `GOOGLE_MAPS_API_KEY` on the backend and enable Google Distance Matrix API (Legacy) in that key's Google Cloud project. Restart the server after setting the key. Without it, quotes return 503 `DISTANCE_UNAVAILABLE`.

All endpoints work under `/api` and `/api/v1`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/add-ons` | Active add-ons in `{ "success": true, "data": [...] }` |
| POST | `/add-ons` | Admin creates an add-on |
| PATCH | `/add-ons/:id` | Admin updates an add-on, including its price or status |
| POST | `/booking/quote` | Calculate a quote from current database prices |
| GET | `/distance-pricing-rules` | Admin lists all distance rules |
| POST | `/distance-pricing-rules` | Admin creates a distance rule |
| PATCH | `/distance-pricing-rules/:id` | Admin updates a distance rule |

Admin writes require `Authorization: Bearer <ADMIN_API_KEY>`. Create fields: `code`, `name`, `pricing_type`, `price`; optional `description`, `currency` (default `SGD`), `status` (default `ACTIVE`). `code` uses uppercase letters, digits and underscores and cannot be patched. `pricing_type` is `FIXED` or `PER_STOP`; `status` is `ACTIVE` or `INACTIVE`. PATCH accepts the other fields. Prices are nonnegative, at most 1,000,000, with at most two decimal places. Admin writes return `{ "success": true, "add_on": {...} }`. Deactivate an add-on using PATCH rather than deleting it.

Quote request (JSON):

```json
{
  "vehicle_id": 3,
  "service_id": 1,
  "pickup": { "address": "Changi Airport Terminal 1" },
  "drop": { "address": "Marina Bay Sands" },
  "add_ons": [
    { "add_on_id": 1, "quantity": 1 },
    { "add_on_id": 2, "quantity": 1 },
    { "add_on_id": 3, "quantity": 1 },
    { "add_on_id": 4, "quantity": 2 },
    { "add_on_id": 5, "quantity": 1 }
  ]
}
```

Read IDs from the APIs; do not assume these example IDs. A vehicle's service prices include `serviceId`. Send an empty `add_ons` array when no extras are selected. Each selection must have a unique ID. Fixed add-ons require quantity 1; per-stop quantities range from 1 to 100. The client must not submit prices or totals. Night travel and Meet & Greet are explicitly selected by the customer; this API does not infer applicability from a travel time or enforce arrival-only selection.

`pickup` and `drop` are required objects, each containing only an `address` string (1 to 500 characters). The backend asks Google Distance Matrix through the official Node.js SDK for driving distance, using Singapore as the address region. Clients cannot supply distances or surcharges. No straight-line calculation or fallback to a zero distance charge is used. Stop quantities price optional services; the current request has no intermediate stop addresses, so distance covers pickup to drop only.

Available responses retain the existing `quote` wrapper and add `quote_status`:

```json
{
  "success": true,
  "quote_status": "AVAILABLE",
  "quote": {
    "vehicle": { "id": 3, "name": "Toyota Alphard / Vellfire", "price": 80 },
    "service": { "id": 1, "name": "Arrival", "unit": "trip" },
    "catalog_id": 12,
    "route": { "pickup": "Changi Airport Terminal 1", "drop": "Marina Bay Sands", "distance_km": 29.4 },
    "distance_charge": { "rule_id": 2, "rule": "[28,30) km", "amount": 5 },
    "add_ons": [
      { "id": 2, "code": "MEET_GREET", "name": "Arrival Meet & Greet", "pricing_type": "FIXED", "quantity": 1, "unit_price": 20, "amount": 20 },
      { "id": 3, "code": "BABY_SEAT", "name": "Baby Seat", "pricing_type": "FIXED", "quantity": 1, "unit_price": 20, "amount": 20 }
    ],
    "vehicle_amount": 80,
    "distance_amount": 5,
    "add_on_amount": 40,
    "total_amount": 125,
    "currency": "SGD"
  }
}
```

This response example selects only Meet & Greet and Baby Seat. The five-add-on request above would cost $175 at a driving distance of 29.4 km. Actual route distance comes from Google, and actual fares come from the database. Vehicle, add-on and distance-rule prices are read in one database statement; totals are calculated in integer cents.

Default distance brackets:

| Driving distance | Surcharge |
| --- | --- |
| 0 to less than 28 km | SGD 0 |
| 28 to less than 30 km | SGD 5 |
| 30 to less than 32 km | SGD 10 |
| 32 to 35 km inclusive | SGD 15 |
| Greater than 35 km | Contact support |

Meters are compared directly with configured boundaries, without rounding distance before pricing. For a contact-support rule the API returns HTTP 200 with `success: true`, `quote_status: "CONTACT_SUPPORT"`, `route`, `distance: { "value": 38.7, "unit": "km" }`, a support message, and `whatsapp: { "enabled": true }`. It returns no `quote` or amounts. The frontend supplies its existing WhatsApp contact link; no phone number was specified for this API.

Distance rules use `min_distance_km`, nullable `max_distance_km` (null means unbounded), `min_inclusive` (default true), `max_inclusive` (default false), `surcharge` (default 0), `currency` (default SGD), `is_contact_support` (default false), and `status` (ACTIVE/INACTIVE). Distances allow up to three decimal places. Contact-support rules require surcharge 0. All rule endpoints require the admin token. For example, `PATCH /api/distance-pricing-rules/2` with `{ "surcharge": 7.5 }` changes a charge without changing code. Read actual IDs from the admin list. PostgreSQL rejects overlapping active ranges with 409 `OVERLAPPING_RULES`. Updates violating bounds or contact-support constraints return 400. Gaps cause quotes to return 503 `DISTANCE_PRICING_UNAVAILABLE`; keep brackets covering the intended distance domain. Rule creation returns `{ "success": true, "distance_rule": {...} }`; updates use the same structure.

Hourly services require integer `hours` from 1 to 24, meeting the service price's `minimumHours`. Their vehicle amount is the hourly rate multiplied by hours; extras are added once according to their quantities. Trip services reject `hours`. Starting-price (`isFrom`) rates return 409 `QUOTE_UNAVAILABLE` because an exact fare is not configured.

Inactive vehicles, services, prices or add-ons and future/expired vehicle prices cannot be quoted (404). Mixed currencies (including distance rules), duplicate IDs, invalid quantities, and unknown fields return 400. Duplicate admin codes return 409. Google failures/timeouts or missing configuration return 503 `DISTANCE_UNAVAILABLE`; a ZERO_RESULTS or NOT_FOUND route element returns 422 `ROUTE_NOT_FOUND`. Quote requests require `Content-Type: application/json` (415 otherwise). Responses use `Cache-Control: no-store`.

Quotes do not create a booking, reserve inventory, take payment, or guarantee a price for later use. Use [booking checkout](checkout-api.md) to recalculate prices, save booking snapshots and get a Stripe-hosted payment URL.
# Delete an add-on

`DELETE /api/v1/add-ons/:id` (also `/api/add-ons/:id`) requires an admin Bearer token. No request body or Content-Type header is needed. Returns 204 with no body on deletion, or 404 if missing. After applying migration 018 with `npm run db:migrate`, deletion is allowed if the add-on is unused or every linked booking has `booking_status = 'COMPLETED'`. Historical add-on snapshots (code, name, quantity and prices) remain; their `add_on_id` becomes null. Any linked booking with another operational status, including CANCELLED, blocks deletion with 409 `ADD_ON_IN_USE`; use PATCH with `{"status":"INACTIVE"}` instead. Payment status PAID alone does not permit deletion.

