# Maxicab API — Frontend handoff

Version: 5 October 2026. Verified against the current Express routes, validators and response builders. This is the complete reference for 24 distinct endpoint contracts; /api/v1 aliases share the same contracts.

All examples contain illustrative data, not live quotes. Read real IDs and rates from the APIs. The example scenario uses an SGD 80 vehicle, 29.4 km driving route (+5), Meet & Greet (+20), Baby Seat (+20), and two within-2-km stops (+20): total SGD 145. Do not assume the real route distance or total equals the example.

## 1. Connection, headers and authentication

- Local base URL: http://127.0.0.1:3000. Replace with the deployed backend URL.
- API prefix: /api (or /api/v1). The /health and /ready paths are at the root and do not use a prefix.
- JSON writes: Content-Type: application/json. UTF-8 JSON object bodies; unknown fields are generally rejected.
- Public endpoints require no token. Admin endpoints require Authorization: Bearer <ADMIN_API_KEY>. Keep this secret in an authenticated dashboard backend, not in React bundles. This API does not implement admin user login.
- Stripe webhook authenticates with Stripe-Signature and STRIPE_WEBHOOK_SECRET; it does not use ADMIN_API_KEY.
- Checkout retry header: Idempotency-Key, preferably a UUID. Save it before the request and reuse for the same attempt.
- X-Request-ID is included on responses. Error JSON includes requestId for support/debugging. Do not log customer information or secrets.
- Standard API limit is 120 requests per minute per IP. HTTP 429 uses RATE_LIMITED and standard RateLimit headers. OPTIONS preflights are handled by CORS before the limiter.
- JSON bodies are limited to 10 KB; Stripe raw webhook bodies to 64 KB. Many list/quote/checkout responses use Cache-Control: no-store.

### Browser CORS — current integration limitation

Allowed origins in src/app.js are https://singapore-maxicabs.vercel.app and https://www.singaporemaxicabs.com.sg. localhost origins are not currently allowed. Allowed custom request headers are Content-Type and Authorization only. A cross-origin browser request carrying Idempotency-Key will fail preflight until the backend allows that header or the frontend uses a same-origin server proxy. X-Request-ID and Idempotency-Key response headers are not currently exposed to cross-origin browser JavaScript. Postman is unaffected by browser CORS. Browser credential/cookie support is not enabled. Backend behavior has not been changed as part of this document.

## 2. Endpoint index

| # | Method | Path | Access | HTTP success | Purpose |
| --- | --- | --- | --- | --- | --- |
| 1 | GET | /api/vehicles | Public | 200 | List vehicle cards |
| 2 | GET | /api/vehicles/recommend | Public | 200 | Recommend a vehicle |
| 3 | GET | /api/vehicles/3 | Public | 200 | Get one vehicle |
| 4 | GET | /api/services | Public | 200 | List active services |
| 5 | GET | /api/vehicle-types | Public | 200 | List vehicle types |
| 6 | GET | /api/catalog/12 | Public | 200 | Resolve a vehicle/service price |
| 7 | GET | /api/add-ons | Public | 200 | List active add-ons |
| 8 | POST | /api/booking/quote | Public | 200 | Calculate a quotation |
| 9 | POST | /api/bookings/checkout | Public | 200 | Create booking and Stripe checkout |
| 10 | POST | /api/vehicle-types | Admin | 201 | Create vehicle type |
| 11 | PATCH | /api/vehicle-types/2 | Admin | 200 | Update vehicle type |
| 12 | POST | /api/vehicles | Admin | 201 | Create vehicle and rates |
| 13 | PATCH | /api/vehicles/3 | Admin | 200 | Update vehicle details |
| 14 | PUT | /api/vehicles/3/prices/arrival | Admin | 200 | Set or replace one service rate |
| 15 | POST | /api/services | Admin | 201 | Create service |
| 16 | PATCH | /api/services/city_tour | Admin | 200 | Update service |
| 17 | POST | /api/add-ons | Admin | 201 | Create add-on |
| 18 | PATCH | /api/add-ons/3 | Admin | 200 | Update add-on |
| 19 | GET | /api/distance-pricing-rules | Admin | 200 | List distance rules |
| 20 | POST | /api/distance-pricing-rules | Admin | 201 | Create distance rule |
| 21 | PATCH | /api/distance-pricing-rules/2 | Admin | 200 | Update distance rule |
| 22 | GET | /health | Public | 200 | Process health |
| 23 | GET | /ready | Public | 200 | Database readiness |
| 24 | POST | /api/payments/stripe/webhook | Stripe signature | 200 | Stripe payment notification |

## 3. Frontend flow and identifiers

1. GET /api/vehicles and GET /api/services; render cards from data and rates from each vehicle.prices.
2. GET /api/vehicles/recommend?persons=5&luggage=4 when counts are supplied. Keep all cards and show the badge only when recommendation is true.
3. Read add-ons from GET /api/add-ons and collect pickup/drop addresses plus selected IDs/quantities.
4. POST /api/booking/quote whenever the selection changes. Render quote fields only when quote_status is AVAILABLE. CONTACT_SUPPORT has no amounts; display the support action instead.
5. POST /api/bookings/checkout with customer information and the same selection, using a retained Idempotency-Key. The server can calculate a different fare from the earlier quote if prices/distance changed; use the returned amount.
6. Redirect to stripe_checkout_url. A redirect back to the success page is not payment verification. Stripe's verified webhook updates the booking in PostgreSQL.

| Identifier | Example | Source / use |
| --- | --- | --- |
| vehicle_id | 3 (integer) | data[].id; quote and checkout |
| service_id | 1 (integer) | price.serviceId or services[].id; quote and checkout |
| service code | arrival (string) | Key in vehicle.prices; used in admin price PUT and service PATCH paths |
| catalogId | 12 (integer) | Exact vehicle/service price record; GET /catalog/:id |
| add_on_id | 2 (integer) | add-ons data[].id; selected quantities |
| booking_id | BK20261005001 (string) | Public number returned by checkout, also Stripe metadata |
| booking_uuid | UUID (string) | Internal correlation for signed Stripe events, not a checkout request field |

Vehicle/service responses use camelCase fields; quote, checkout, add-on and distance-rule requests use the snake_case fields shown. There is no universal success wrapper: use each endpoint's documented response. Numeric money fields represent major currency units unless named amountMinor or Stripe amount_total. Format displayed currency with the price's currency; do not recompute authoritative totals in React.

### Validation reference

| Object / field | Contract |
| --- | --- |
| persons / luggage query | Integer text values: persons 1–100; luggage 0–100; both supplied together; no repeated/unknown keys |
| vehicle/service/add-on selection IDs | Positive integers up to 2,147,483,647 for quote/checkout; discover from API |
| pickup / drop | Object with only address; nonblank string up to 500 characters; no coordinates, place IDs or client distance supported in current quote contract |
| add_ons | Required array, 0–100 selections; each has only add_on_id and integer quantity 1–100; no duplicate IDs |
| FIXED / PER_STOP | FIXED quantity must be 1; PER_STOP multiplies database price by quantity |
| hours | Only for hourly services; integer 1–24, meeting configured minimumHours |
| customer | Required checkout object with only name (1–150 trimmed characters), email (valid, up to 254), phone (+ followed by 7–15 digits, first digit nonzero) |
| payment_method | Required checkout value STRIPE; no CASH alternative |
| checkout money | Client amount/currency rejected; backend SGD total must be 0.50–999999.99 |
| Idempotency-Key | Optional header, 8–128 letters/digits/underscores/hyphens; UUID recommended |
| vehicle name / description | name 1–120 trimmed characters; description string up to 1,000 |
| passengerCapacity / luggageCapacity | Null or integer; passenger 1–100; luggage 0–100 |
| vehicleTypeId / imageUrl | Nullable positive type ID; nullable HTTP(S) image URL up to 2,048 characters |
| vehicle / service status | active or inactive (lowercase); vehicle status OR isActive boolean, not both |
| vehicle / price currency | Three uppercase letters; vehicle POST requires currency; current quote selections must share currency |
| amounts / add-on price / surcharge | Numbers 0–1,000,000 with at most 2 decimals; strings are rejected |
| service code / name / unit | code: 1–64 lowercase letters/digits/underscores starting with a letter; name 1–120; unit trip or hour; code/unit immutable after creation |
| service sortOrder | Integer 0–100000 |
| price validFrom / validTo | ISO timestamp with timezone or null; validTo later than validFrom (current time if start omitted/null); eligibility includes start and excludes end |
| add-on code / name / description | code: 1–50 uppercase letters/digits/underscores starting with a letter; name 1–150; description up to 1,000 |
| pricing_type / add-on status | FIXED or PER_STOP; ACTIVE or INACTIVE (uppercase) |
| distance bounds | Nonnegative numbers up to 9,999,999 with at most 3 decimals; maximum null means unbounded; finite maximum greater than minimum |
| distance flags | min_inclusive, max_inclusive, is_contact_support booleans; ACTIVE/INACTIVE status; support rules require surcharge 0 |

## 4. Requests and responses

### Public catalog

#### 1. List vehicle cards

**GET /api/vehicles**

Access: Public.

Request body: none.

Example HTTP 200 response:
```json
{
  "success": true,
  "requirements": null,
  "data": [
    {
      "id": 3,
      "name": "Toyota Alphard / Vellfire",
      "description": "Executive MPV",
      "passengerCapacity": 6,
      "currency": "SGD",
      "vehicleTypeId": 2,
      "vehicleType": "MPV",
      "imageUrl": "https://example.com/images/alphard.jpg",
      "status": "active",
      "updatedAt": "2026-10-05T00:00:00.000Z",
      "luggageCapacity": 6,
      "isActive": true,
      "createdAt": "2026-10-01T00:00:00.000Z",
      "prices": {
        "arrival": {
          "catalogId": 12,
          "serviceId": 1,
          "amount": 80,
          "amountMinor": 8000,
          "currency": "SGD",
          "validFrom": "2026-10-01T00:00:00.000Z",
          "validTo": null,
          "status": "active",
          "isFrom": false,
          "unit": "trip",
          "serviceName": "Arrival",
          "minimumHours": null
        },
        "departure_transfer": {
          "catalogId": 13,
          "serviceId": 2,
          "amount": 70,
          "amountMinor": 7000,
          "currency": "SGD",
          "validFrom": "2026-10-01T00:00:00.000Z",
          "validTo": null,
          "status": "active",
          "isFrom": false,
          "unit": "trip",
          "serviceName": "Departure Transfer",
          "minimumHours": null
        },
        "hourly": {
          "catalogId": 14,
          "serviceId": 3,
          "amount": 65,
          "amountMinor": 6500,
          "currency": "SGD",
          "validFrom": "2026-10-01T00:00:00.000Z",
          "validTo": null,
          "status": "active",
          "isFrom": false,
          "unit": "hour",
          "serviceName": "Hourly",
          "minimumHours": 3
        }
      },
      "recommendation": false
    }
  ]
}
```

No request body. Optional query parameters: persons and luggage, supplied together. Without counts, requirements is null and all recommendation flags are false. Only active vehicles are listed. Every card remains in the result after recommendation; an empty catalog returns data: []. No top-level vehicles alias is returned.

Endpoint-specific errors: 400 INVALID_INPUT for unknown, incomplete, repeated or invalid query parameters.

#### 2. Recommend a vehicle

**GET /api/vehicles/recommend?persons=5&luggage=4**

Access: Public.

Request body: none.

Example HTTP 200 response:
```json
{
  "success": true,
  "requirements": {
    "persons": 5,
    "luggage": 4
  },
  "data": [
    {
      "id": 3,
      "name": "Toyota Alphard / Vellfire",
      "description": "Executive MPV",
      "passengerCapacity": 6,
      "currency": "SGD",
      "vehicleTypeId": 2,
      "vehicleType": "MPV",
      "imageUrl": "https://example.com/images/alphard.jpg",
      "status": "active",
      "updatedAt": "2026-10-05T00:00:00.000Z",
      "luggageCapacity": 6,
      "isActive": true,
      "createdAt": "2026-10-01T00:00:00.000Z",
      "prices": {
        "arrival": {
          "catalogId": 12,
          "serviceId": 1,
          "amount": 80,
          "amountMinor": 8000,
          "currency": "SGD",
          "validFrom": "2026-10-01T00:00:00.000Z",
          "validTo": null,
          "status": "active",
          "isFrom": false,
          "unit": "trip",
          "serviceName": "Arrival",
          "minimumHours": null
        },
        "departure_transfer": {
          "catalogId": 13,
          "serviceId": 2,
          "amount": 70,
          "amountMinor": 7000,
          "currency": "SGD",
          "validFrom": "2026-10-01T00:00:00.000Z",
          "validTo": null,
          "status": "active",
          "isFrom": false,
          "unit": "trip",
          "serviceName": "Departure Transfer",
          "minimumHours": null
        },
        "hourly": {
          "catalogId": 14,
          "serviceId": 3,
          "amount": 65,
          "amountMinor": 6500,
          "currency": "SGD",
          "validFrom": "2026-10-01T00:00:00.000Z",
          "validTo": null,
          "status": "active",
          "isFrom": false,
          "unit": "hour",
          "serviceName": "Hourly",
          "minimumHours": 3
        }
      },
      "recommendation": true
    }
  ]
}
```

Both counts are required: persons integer 1–100; luggage integer 0–100. GET /vehicles?persons=5&luggage=4 produces the same structure. A single best-fitting eligible card gets recommendation: true; all others remain with false. Unknown capacities and unpriced vehicles cannot be recommended. Ranking minimizes total unused seats and luggage capacity, then passenger capacity, luggage capacity and vehicle ID. If no vehicle fits, HTTP 200 still returns all cards with false. recommendation=false does not mean unsuitable.

Endpoint-specific errors: 400 INVALID_INPUT.

#### 3. Get one vehicle

**GET /api/vehicles/3**

Access: Public.

Request body: none.

Example HTTP 200 response:
```json
{
  "vehicle": {
    "id": 3,
    "name": "Toyota Alphard / Vellfire",
    "description": "Executive MPV",
    "passengerCapacity": 6,
    "currency": "SGD",
    "vehicleTypeId": 2,
    "vehicleType": "MPV",
    "imageUrl": "https://example.com/images/alphard.jpg",
    "status": "active",
    "updatedAt": "2026-10-05T00:00:00.000Z",
    "luggageCapacity": 6,
    "isActive": true,
    "createdAt": "2026-10-01T00:00:00.000Z",
    "prices": {
      "arrival": {
        "catalogId": 12,
        "serviceId": 1,
        "amount": 80,
        "amountMinor": 8000,
        "currency": "SGD",
        "validFrom": "2026-10-01T00:00:00.000Z",
        "validTo": null,
        "status": "active",
        "isFrom": false,
        "unit": "trip",
        "serviceName": "Arrival",
        "minimumHours": null
      },
      "departure_transfer": {
        "catalogId": 13,
        "serviceId": 2,
        "amount": 70,
        "amountMinor": 7000,
        "currency": "SGD",
        "validFrom": "2026-10-01T00:00:00.000Z",
        "validTo": null,
        "status": "active",
        "isFrom": false,
        "unit": "trip",
        "serviceName": "Departure Transfer",
        "minimumHours": null
      },
      "hourly": {
        "catalogId": 14,
        "serviceId": 3,
        "amount": 65,
        "amountMinor": 6500,
        "currency": "SGD",
        "validFrom": "2026-10-01T00:00:00.000Z",
        "validTo": null,
        "status": "active",
        "isFrom": false,
        "unit": "hour",
        "serviceName": "Hourly",
        "minimumHours": 3
      }
    }
  }
}
```

Path id is the vehicle ID. The single-record response has no recommendation field. Current implementation can return an inactive vehicle by ID; list and quote endpoints apply active visibility filters.

Endpoint-specific errors: 404 NOT_FOUND for a missing vehicle.

#### 4. List active services

**GET /api/services**

Access: Public.

Request body: none.

Example HTTP 200 response:
```json
{
  "services": [
    {
      "id": 1,
      "code": "arrival",
      "name": "Arrival",
      "unit": "trip",
      "status": "active",
      "sortOrder": 0
    },
    {
      "id": 2,
      "code": "departure_transfer",
      "name": "Departure Transfer",
      "unit": "trip",
      "status": "active",
      "sortOrder": 1
    },
    {
      "id": 3,
      "code": "hourly",
      "name": "Hourly",
      "unit": "hour",
      "status": "active",
      "sortOrder": 2
    }
  ]
}
```

No body. Read service IDs and codes dynamically. Services are sorted by sortOrder then code. A service exists independently of whether a selected vehicle has a configured price; offer only prices present on that vehicle.

#### 5. List vehicle types

**GET /api/vehicle-types**

Access: Public.

Request body: none.

Example HTTP 200 response:
```json
{
  "vehicleTypes": [
    {
      "id": 2,
      "name": "MPV",
      "description": "Multi-purpose vehicle"
    }
  ]
}
```

No body. Types have id, name and description.

#### 6. Resolve a vehicle/service price

**GET /api/catalog/12**

Access: Public.

Request body: none.

Example HTTP 200 response:
```json
{
  "catalog": {
    "catalogId": 12,
    "vehicleId": 3,
    "vehicleName": "Toyota Alphard / Vellfire",
    "currency": "SGD",
    "service": "arrival",
    "price": {
      "catalogId": 12,
      "serviceId": 1,
      "amount": 80,
      "amountMinor": 8000,
      "currency": "SGD",
      "validFrom": "2026-10-01T00:00:00.000Z",
      "validTo": null,
      "status": "active",
      "isFrom": false,
      "unit": "trip",
      "serviceName": "Arrival",
      "minimumHours": null
    }
  }
}
```

Path id is catalogId, not vehicle ID. Resolves an active vehicle/service price valid now. The ID survives rate edits and does not lock a quote. Quote and checkout currently take vehicle_id plus service_id, not catalogId.

Endpoint-specific errors: 404 NOT_FOUND for missing/ineligible catalog entries.

### Public booking flow

#### 7. List active add-ons

**GET /api/add-ons**

Access: Public.

Request body: none.

Example HTTP 200 response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "code": "NIGHT_TRAVEL",
      "name": "Travelling between 23:30–06:30",
      "description": "",
      "pricing_type": "FIXED",
      "price": 10,
      "currency": "SGD",
      "status": "ACTIVE",
      "created_at": "2026-10-01T00:00:00.000Z",
      "updated_at": "2026-10-05T00:00:00.000Z"
    },
    {
      "id": 2,
      "code": "MEET_GREET",
      "name": "Arrival Meet & Greet",
      "description": "",
      "pricing_type": "FIXED",
      "price": 20,
      "currency": "SGD",
      "status": "ACTIVE",
      "created_at": "2026-10-01T00:00:00.000Z",
      "updated_at": "2026-10-05T00:00:00.000Z"
    },
    {
      "id": 3,
      "code": "BABY_SEAT",
      "name": "Baby Seat",
      "description": "",
      "pricing_type": "FIXED",
      "price": 20,
      "currency": "SGD",
      "status": "ACTIVE",
      "created_at": "2026-10-01T00:00:00.000Z",
      "updated_at": "2026-10-05T00:00:00.000Z"
    },
    {
      "id": 4,
      "code": "STOP_WITHIN_2KM",
      "name": "Additional Stop within 2 km",
      "description": "",
      "pricing_type": "PER_STOP",
      "price": 10,
      "currency": "SGD",
      "status": "ACTIVE",
      "created_at": "2026-10-01T00:00:00.000Z",
      "updated_at": "2026-10-05T00:00:00.000Z"
    },
    {
      "id": 5,
      "code": "STOP_OVER_2KM",
      "name": "Additional Stop more than 2 km",
      "description": "",
      "pricing_type": "PER_STOP",
      "price": 20,
      "currency": "SGD",
      "status": "ACTIVE",
      "created_at": "2026-10-01T00:00:00.000Z",
      "updated_at": "2026-10-05T00:00:00.000Z"
    }
  ]
}
```

No body. Prices are numeric major currency units. IDs and rates come from the API. FIXED selections require quantity 1; PER_STOP options accept quantities. Status values here are uppercase. Night travel is manually selected; no pickup timestamp or automatic night detection is implemented. Meet & Greet is not automatically restricted to an arrival service.

#### 8. Calculate a quotation

**POST /api/booking/quote**

Access: Public.

Request body:
```json
{
  "vehicle_id": 3,
  "service_id": 1,
  "pickup": {
    "address": "Changi Airport Terminal 1"
  },
  "drop": {
    "address": "Marina Bay Sands"
  },
  "add_ons": [
    {
      "add_on_id": 2,
      "quantity": 1
    },
    {
      "add_on_id": 3,
      "quantity": 1
    },
    {
      "add_on_id": 4,
      "quantity": 2
    }
  ]
}
```

Example HTTP 200 response:
```json
{
  "success": true,
  "quote_status": "AVAILABLE",
  "quote": {
    "vehicle": {
      "id": 3,
      "name": "Toyota Alphard / Vellfire",
      "price": 80
    },
    "service": {
      "id": 1,
      "name": "Arrival",
      "unit": "trip"
    },
    "catalog_id": 12,
    "add_ons": [
      {
        "id": 2,
        "code": "MEET_GREET",
        "name": "Arrival Meet & Greet",
        "pricing_type": "FIXED",
        "quantity": 1,
        "unit_price": 20,
        "amount": 20
      },
      {
        "id": 3,
        "code": "BABY_SEAT",
        "name": "Baby Seat",
        "pricing_type": "FIXED",
        "quantity": 1,
        "unit_price": 20,
        "amount": 20
      },
      {
        "id": 4,
        "code": "STOP_WITHIN_2KM",
        "name": "Additional Stop within 2 km",
        "pricing_type": "PER_STOP",
        "quantity": 2,
        "unit_price": 10,
        "amount": 20
      }
    ],
    "vehicle_amount": 80,
    "add_on_amount": 60,
    "total_amount": 145,
    "currency": "SGD",
    "route": {
      "pickup": "Changi Airport Terminal 1",
      "drop": "Marina Bay Sands",
      "distance_km": 29.4
    },
    "distance_charge": {
      "rule_id": 2,
      "rule": "[28,30) km",
      "amount": 5
    },
    "distance_amount": 5
  }
}
```

Pickup and drop addresses are required. Google Distance Matrix supplies driving meters; the backend selects a database distance bracket and adds vehicle fare + distance surcharge + add-ons. The response keeps the quote wrapper. Send add_ons: [] for no extras. For an hourly service, also send hours: 3 (or another integer 1–24 meeting minimumHours); the response includes quote.hours and vehicle_amount is hourly rate × hours. Trip services reject hours. Never send prices, currency, client distance or totals. The 29.4 km route is illustrative, not a guaranteed Google result. Quotes do not save a booking or reserve inventory.

Endpoint-specific errors: 400 INVALID_INPUT; 404 NOT_FOUND for inactive/missing selections; 409 QUOTE_UNAVAILABLE for isFrom fares; 422 ROUTE_NOT_FOUND; 503 DISTANCE_UNAVAILABLE or DISTANCE_PRICING_UNAVAILABLE.

Alternate HTTP 200 contact-support response:
```json
{
  "success": true,
  "quote_status": "CONTACT_SUPPORT",
  "route": {
    "pickup": "Changi Airport Terminal 1",
    "drop": "Marina Bay Sands",
    "distance_km": 38.7
  },
  "distance": {
    "value": 38.7,
    "unit": "km"
  },
  "message": "This route requires a customized quotation. Please contact our support team via WhatsApp.",
  "whatsapp": {
    "enabled": true
  }
}
```

#### 9. Create booking and Stripe checkout

**POST /api/bookings/checkout**

Access: Public.

Request body:
```json
{
  "customer": {
    "name": "John Smith",
    "email": "john@example.com",
    "phone": "+6591234567"
  },
  "vehicle_id": 3,
  "service_id": 1,
  "pickup": {
    "address": "Changi Airport Terminal 1"
  },
  "drop": {
    "address": "Marina Bay Sands"
  },
  "add_ons": [
    {
      "add_on_id": 2,
      "quantity": 1
    },
    {
      "add_on_id": 3,
      "quantity": 1
    },
    {
      "add_on_id": 4,
      "quantity": 2
    }
  ],
  "payment_method": "STRIPE"
}
```

Recommended header: Idempotency-Key: <UUID retained for this attempt>.

Example HTTP 200 response:
```json
{
  "success": true,
  "booking_id": "BK20261005001",
  "payment_status": "PENDING",
  "amount": 145,
  "currency": "SGD",
  "stripe_checkout_url": "https://checkout.stripe.com/..."
}
```

Recommended request header: Idempotency-Key with a frontend-generated UUID. The server recalculates the quote, saves a booking and price snapshots, then creates Stripe Checkout. It returns flat payment fields. Database PENDING_PAYMENT is presented as payment_status: PENDING. Amount/currency inputs are rejected. Customer fields are required. A successful HTTP response gives a checkout URL, not proof of payment. Navigate the customer to stripe_checkout_url. New attempts require new keys; retry the same attempt with the same key and details. Do not reuse a key after the customer changes selections. Unavailable support routes return CONTACT_SUPPORT without booking or payment fields.

Endpoint-specific errors: 400 INVALID_INPUT or CHECKOUT_NOT_SUPPORTED; 404 NOT_FOUND; 409 IDEMPOTENCY_CONFLICT, BOOKING_NOT_PENDING, CHECKOUT_EXPIRED or QUOTE_UNAVAILABLE; 422 ROUTE_NOT_FOUND; 503 PAYMENT_NOT_CONFIGURED, PAYMENT_UNAVAILABLE, DISTANCE_UNAVAILABLE or DISTANCE_PRICING_UNAVAILABLE.

Alternate HTTP 200 contact-support response:
```json
{
  "success": true,
  "quote_status": "CONTACT_SUPPORT",
  "route": {
    "pickup": "Changi Airport Terminal 1",
    "drop": "Marina Bay Sands",
    "distance_km": 38.7
  },
  "distance": {
    "value": 38.7,
    "unit": "km"
  },
  "message": "This route requires a customized quotation. Please contact our support team via WhatsApp.",
  "whatsapp": {
    "enabled": true
  }
}
```

### Admin catalog

#### 10. Create vehicle type

**POST /api/vehicle-types**

Access: Admin.

Request body:
```json
{
  "name": "Executive MPV",
  "description": "Premium carrier"
}
```

Required header: Authorization: Bearer <ADMIN_API_KEY>. For writes, also Content-Type: application/json.

Example HTTP 201 response:
```json
{
  "vehicleType": {
    "id": 4,
    "name": "Executive MPV",
    "description": "Premium carrier"
  }
}
```

name is required (1–120 characters); description is optional (up to 1,000). Type names must be unique.

Endpoint-specific errors: 400 INVALID_INPUT; 409 ALREADY_EXISTS.

#### 11. Update vehicle type

**PATCH /api/vehicle-types/2**

Access: Admin.

Request body:
```json
{
  "name": "Premium MPV",
  "description": "Updated category"
}
```

Required header: Authorization: Bearer <ADMIN_API_KEY>. For writes, also Content-Type: application/json.

Example HTTP 200 response:
```json
{
  "vehicleType": {
    "id": 2,
    "name": "Premium MPV",
    "description": "Updated category"
  }
}
```

Send a nonempty object containing name and/or description. Other fields are rejected.

Endpoint-specific errors: 400 INVALID_INPUT; 404 NOT_FOUND; 409 ALREADY_EXISTS.

#### 12. Create vehicle and rates

**POST /api/vehicles**

Access: Admin.

Request body:
```json
{
  "name": "New Executive MPV",
  "description": "Premium carrier",
  "passengerCapacity": 6,
  "luggageCapacity": 6,
  "currency": "SGD",
  "vehicleTypeId": 2,
  "imageUrl": "https://example.com/images/alphard.jpg",
  "status": "active",
  "prices": {
    "arrival": {
      "amount": 80
    },
    "departure_transfer": {
      "amount": 70
    },
    "hourly": {
      "amount": 65,
      "minimumHours": 3
    }
  }
}
```

Required header: Authorization: Bearer <ADMIN_API_KEY>. For writes, also Content-Type: application/json.

Example HTTP 201 response:
```json
{
  "vehicle": {
    "id": 11,
    "name": "New Executive MPV",
    "description": "Premium carrier",
    "passengerCapacity": 6,
    "currency": "SGD",
    "vehicleTypeId": 2,
    "vehicleType": "MPV",
    "imageUrl": "https://example.com/images/alphard.jpg",
    "status": "active",
    "updatedAt": "2026-10-05T00:00:00.000Z",
    "luggageCapacity": 6,
    "isActive": true,
    "createdAt": "2026-10-05T00:00:00.000Z",
    "prices": {
      "arrival": {
        "catalogId": 31,
        "serviceId": 1,
        "amount": 80,
        "amountMinor": 8000,
        "currency": "SGD",
        "validFrom": "2026-10-05T00:00:00.000Z",
        "validTo": null,
        "status": "active",
        "isFrom": false,
        "unit": "trip",
        "serviceName": "Arrival",
        "minimumHours": null
      },
      "departure_transfer": {
        "catalogId": 32,
        "serviceId": 2,
        "amount": 70,
        "amountMinor": 7000,
        "currency": "SGD",
        "validFrom": "2026-10-05T00:00:00.000Z",
        "validTo": null,
        "status": "active",
        "isFrom": false,
        "unit": "trip",
        "serviceName": "Departure Transfer",
        "minimumHours": null
      },
      "hourly": {
        "catalogId": 33,
        "serviceId": 3,
        "amount": 65,
        "amountMinor": 6500,
        "currency": "SGD",
        "validFrom": "2026-10-05T00:00:00.000Z",
        "validTo": null,
        "status": "active",
        "isFrom": false,
        "unit": "hour",
        "serviceName": "Hourly",
        "minimumHours": 3
      }
    }
  }
}
```

Required: name, currency and prices for every currently active service returned by GET /services. The example assumes only arrival, departure_transfer and hourly are active; add other active service codes when needed. Each rate allows amount, isFrom and minimumHours. New vehicle status defaults active; unspecified capacities become null. Response includes Location: /api/v1/vehicles/<new-id>. Creation returns a full vehicle, not a recommendation card.

Endpoint-specific errors: 400 INVALID_INPUT; 404 NOT_FOUND for a missing type; 409 VEHICLE_EXISTS.

#### 13. Update vehicle details

**PATCH /api/vehicles/3**

Access: Admin.

Request body:
```json
{
  "name": "Toyota Alphard Executive",
  "passengerCapacity": 6,
  "luggageCapacity": 5
}
```

Required header: Authorization: Bearer <ADMIN_API_KEY>. For writes, also Content-Type: application/json.

Example HTTP 200 response:
```json
{
  "vehicle": {
    "id": 3,
    "name": "Toyota Alphard Executive",
    "description": "Executive MPV",
    "passengerCapacity": 6,
    "currency": "SGD",
    "vehicleTypeId": 2,
    "vehicleType": "MPV",
    "imageUrl": "https://example.com/images/alphard.jpg",
    "status": "active",
    "updatedAt": "2026-10-05T00:00:00.000Z",
    "luggageCapacity": 5,
    "isActive": true,
    "createdAt": "2026-10-01T00:00:00.000Z",
    "prices": {
      "arrival": {
        "catalogId": 12,
        "serviceId": 1,
        "amount": 80,
        "amountMinor": 8000,
        "currency": "SGD",
        "validFrom": "2026-10-01T00:00:00.000Z",
        "validTo": null,
        "status": "active",
        "isFrom": false,
        "unit": "trip",
        "serviceName": "Arrival",
        "minimumHours": null
      },
      "departure_transfer": {
        "catalogId": 13,
        "serviceId": 2,
        "amount": 70,
        "amountMinor": 7000,
        "currency": "SGD",
        "validFrom": "2026-10-01T00:00:00.000Z",
        "validTo": null,
        "status": "active",
        "isFrom": false,
        "unit": "trip",
        "serviceName": "Departure Transfer",
        "minimumHours": null
      },
      "hourly": {
        "catalogId": 14,
        "serviceId": 3,
        "amount": 65,
        "amountMinor": 6500,
        "currency": "SGD",
        "validFrom": "2026-10-01T00:00:00.000Z",
        "validTo": null,
        "status": "active",
        "isFrom": false,
        "unit": "hour",
        "serviceName": "Hourly",
        "minimumHours": 3
      }
    }
  }
}
```

Allowed fields: name, description, passengerCapacity, luggageCapacity, status OR isActive, vehicleTypeId, imageUrl. Send only changes in a nonempty object. Nullable capacities/type/image clear the corresponding values. Currency/prices cannot be patched here. description must be a string; empty string clears it. No DELETE endpoint exists; set status: inactive to hide a vehicle from lists and new quotes.

Endpoint-specific errors: 400 INVALID_INPUT; 404 NOT_FOUND; 409 ALREADY_EXISTS.

#### 14. Set or replace one service rate

**PUT /api/vehicles/3/prices/arrival**

Access: Admin.

Request body:
```json
{
  "amount": 95,
  "currency": "SGD",
  "isFrom": false,
  "validFrom": "2026-10-01T00:00:00.000Z",
  "validTo": null,
  "status": "active"
}
```

Required header: Authorization: Bearer <ADMIN_API_KEY>. For writes, also Content-Type: application/json.

Example HTTP 200 response:
```json
{
  "vehicle": {
    "id": 3,
    "name": "Toyota Alphard / Vellfire",
    "description": "Executive MPV",
    "passengerCapacity": 6,
    "currency": "SGD",
    "vehicleTypeId": 2,
    "vehicleType": "MPV",
    "imageUrl": "https://example.com/images/alphard.jpg",
    "status": "active",
    "updatedAt": "2026-10-05T00:00:00.000Z",
    "luggageCapacity": 6,
    "isActive": true,
    "createdAt": "2026-10-01T00:00:00.000Z",
    "prices": {
      "arrival": {
        "catalogId": 12,
        "serviceId": 1,
        "amount": 95,
        "amountMinor": 9500,
        "currency": "SGD",
        "validFrom": "2026-10-01T00:00:00.000Z",
        "validTo": null,
        "status": "active",
        "isFrom": false,
        "unit": "trip",
        "serviceName": "Arrival",
        "minimumHours": null
      },
      "departure_transfer": {
        "catalogId": 13,
        "serviceId": 2,
        "amount": 70,
        "amountMinor": 7000,
        "currency": "SGD",
        "validFrom": "2026-10-01T00:00:00.000Z",
        "validTo": null,
        "status": "active",
        "isFrom": false,
        "unit": "trip",
        "serviceName": "Departure Transfer",
        "minimumHours": null
      },
      "hourly": {
        "catalogId": 14,
        "serviceId": 3,
        "amount": 65,
        "amountMinor": 6500,
        "currency": "SGD",
        "validFrom": "2026-10-01T00:00:00.000Z",
        "validTo": null,
        "status": "active",
        "isFrom": false,
        "unit": "hour",
        "serviceName": "Hourly",
        "minimumHours": 3
      }
    }
  }
}
```

Path uses service code (arrival), not service ID. amount is required. Omitted isFrom becomes false; minimumHours becomes null; validFrom becomes the database current timestamp; validTo becomes null; status becomes active. Omitted currency reuses the existing rate currency or the vehicle’s single visible currency; provide it explicitly for a new rate on a mixed-currency vehicle. Omitted fields can reset existing settings. For hourly prices, minimumHours may be 1–24. Inactive/future/expired prices are omitted from returned prices. Returns the full combined vehicle; catalogId remains unchanged.

Endpoint-specific errors: 400 INVALID_INPUT; 404 NOT_FOUND for missing vehicle/service.

#### 15. Create service

**POST /api/services**

Access: Admin.

Request body:
```json
{
  "code": "city_tour",
  "name": "City Tour",
  "unit": "hour",
  "sortOrder": 4,
  "status": "active"
}
```

Required header: Authorization: Bearer <ADMIN_API_KEY>. For writes, also Content-Type: application/json.

Example HTTP 201 response:
```json
{
  "service": {
    "id": 4,
    "code": "city_tour",
    "name": "City Tour",
    "unit": "hour",
    "status": "active",
    "sortOrder": 4
  }
}
```

code, name and unit are required. Default sortOrder is 0 and status is active. Creating a service does not create vehicle rates; use price PUT for each vehicle. Codes and billing units cannot be changed later.

Endpoint-specific errors: 400 INVALID_INPUT; 409 ALREADY_EXISTS.

#### 16. Update service

**PATCH /api/services/city_tour**

Access: Admin.

Request body:
```json
{
  "name": "Private City Tour",
  "sortOrder": 5,
  "status": "active"
}
```

Required header: Authorization: Bearer <ADMIN_API_KEY>. For writes, also Content-Type: application/json.

Example HTTP 200 response:
```json
{
  "service": {
    "id": 4,
    "code": "city_tour",
    "name": "Private City Tour",
    "unit": "hour",
    "status": "active",
    "sortOrder": 5
  }
}
```

Nonempty object; name, sortOrder and status only. Path is the service code. Inactive services disappear from public lists and new quotes.

Endpoint-specific errors: 400 INVALID_INPUT; 404 NOT_FOUND; 409 ALREADY_EXISTS.

### Admin extras and pricing

#### 17. Create add-on

**POST /api/add-ons**

Access: Admin.

Request body:
```json
{
  "code": "EXTRA_WAIT",
  "name": "Extra waiting",
  "description": "Optional waiting charge",
  "pricing_type": "FIXED",
  "price": 15,
  "currency": "SGD",
  "status": "ACTIVE"
}
```

Required header: Authorization: Bearer <ADMIN_API_KEY>. For writes, also Content-Type: application/json.

Example HTTP 201 response:
```json
{
  "success": true,
  "add_on": {
    "id": 6,
    "code": "EXTRA_WAIT",
    "name": "Extra waiting",
    "description": "Optional waiting charge",
    "pricing_type": "FIXED",
    "price": 15,
    "currency": "SGD",
    "status": "ACTIVE",
    "created_at": "2026-10-05T00:00:00.000Z",
    "updated_at": "2026-10-05T00:00:00.000Z"
  }
}
```

Required: code, name, pricing_type, price. Defaults: description empty, currency SGD, status ACTIVE. Code is unique and cannot be patched.

Endpoint-specific errors: 400 INVALID_INPUT; 409 ALREADY_EXISTS.

#### 18. Update add-on

**PATCH /api/add-ons/3**

Access: Admin.

Request body:
```json
{
  "price": 25,
  "status": "ACTIVE"
}
```

Required header: Authorization: Bearer <ADMIN_API_KEY>. For writes, also Content-Type: application/json.

Example HTTP 200 response:
```json
{
  "success": true,
  "add_on": {
    "id": 3,
    "code": "BABY_SEAT",
    "name": "Baby Seat",
    "description": "",
    "pricing_type": "FIXED",
    "price": 25,
    "currency": "SGD",
    "status": "ACTIVE",
    "created_at": "2026-10-01T00:00:00.000Z",
    "updated_at": "2026-10-05T00:00:00.000Z"
  }
}
```

Nonempty object. Allowed: name, description, pricing_type, price, currency, status. Deactivate with status: INACTIVE. Existing booking snapshots retain their original names/prices.

Endpoint-specific errors: 400 INVALID_INPUT; 404 NOT_FOUND.

#### 19. List distance rules

**GET /api/distance-pricing-rules**

Access: Admin.

Request body: none.

Required header: Authorization: Bearer <ADMIN_API_KEY>. For writes, also Content-Type: application/json.

Example HTTP 200 response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "min_distance_km": 0,
      "max_distance_km": 28,
      "min_inclusive": true,
      "max_inclusive": false,
      "surcharge": 0,
      "currency": "SGD",
      "is_contact_support": false,
      "status": "ACTIVE",
      "created_at": "2026-10-01T00:00:00.000Z",
      "updated_at": "2026-10-05T00:00:00.000Z"
    },
    {
      "id": 2,
      "min_distance_km": 28,
      "max_distance_km": 30,
      "min_inclusive": true,
      "max_inclusive": false,
      "surcharge": 5,
      "currency": "SGD",
      "is_contact_support": false,
      "status": "ACTIVE",
      "created_at": "2026-10-01T00:00:00.000Z",
      "updated_at": "2026-10-05T00:00:00.000Z"
    },
    {
      "id": 3,
      "min_distance_km": 30,
      "max_distance_km": 32,
      "min_inclusive": true,
      "max_inclusive": false,
      "surcharge": 10,
      "currency": "SGD",
      "is_contact_support": false,
      "status": "ACTIVE",
      "created_at": "2026-10-01T00:00:00.000Z",
      "updated_at": "2026-10-05T00:00:00.000Z"
    },
    {
      "id": 4,
      "min_distance_km": 32,
      "max_distance_km": 35,
      "min_inclusive": true,
      "max_inclusive": true,
      "surcharge": 15,
      "currency": "SGD",
      "is_contact_support": false,
      "status": "ACTIVE",
      "created_at": "2026-10-01T00:00:00.000Z",
      "updated_at": "2026-10-05T00:00:00.000Z"
    },
    {
      "id": 5,
      "min_distance_km": 35,
      "max_distance_km": null,
      "min_inclusive": false,
      "max_inclusive": false,
      "surcharge": 0,
      "currency": "SGD",
      "is_contact_support": true,
      "status": "ACTIVE",
      "created_at": "2026-10-01T00:00:00.000Z",
      "updated_at": "2026-10-05T00:00:00.000Z"
    }
  ]
}
```

Admin token required even though this is a GET. Returns active and inactive rules. Frontend booking UI can use the quoted distance_charge; it does not need admin rule access.

#### 20. Create distance rule

**POST /api/distance-pricing-rules**

Access: Admin.

Request body:
```json
{
  "min_distance_km": 40,
  "max_distance_km": null,
  "min_inclusive": false,
  "max_inclusive": false,
  "surcharge": 0,
  "currency": "SGD",
  "is_contact_support": true,
  "status": "INACTIVE"
}
```

Required header: Authorization: Bearer <ADMIN_API_KEY>. For writes, also Content-Type: application/json.

Example HTTP 201 response:
```json
{
  "success": true,
  "distance_rule": {
    "id": 6,
    "min_distance_km": 40,
    "max_distance_km": null,
    "min_inclusive": false,
    "max_inclusive": false,
    "surcharge": 0,
    "currency": "SGD",
    "is_contact_support": true,
    "status": "INACTIVE",
    "created_at": "2026-10-05T00:00:00.000Z",
    "updated_at": "2026-10-05T00:00:00.000Z"
  }
}
```

min_distance_km is required. Defaults: max_distance_km null, min_inclusive true, max_inclusive false, surcharge 0, currency SGD, is_contact_support false, status ACTIVE. Example is inactive so it does not overlap the default >35 km rule. Active ranges cannot overlap. A null maximum is unbounded. Rule gaps cause quoting failures instead of a zero-charge fallback.

Endpoint-specific errors: 400 INVALID_INPUT; 409 OVERLAPPING_RULES.

#### 21. Update distance rule

**PATCH /api/distance-pricing-rules/2**

Access: Admin.

Request body:
```json
{
  "surcharge": 7.5
}
```

Required header: Authorization: Bearer <ADMIN_API_KEY>. For writes, also Content-Type: application/json.

Example HTTP 200 response:
```json
{
  "success": true,
  "distance_rule": {
    "id": 2,
    "min_distance_km": 28,
    "max_distance_km": 30,
    "min_inclusive": true,
    "max_inclusive": false,
    "surcharge": 7.5,
    "currency": "SGD",
    "is_contact_support": false,
    "status": "ACTIVE",
    "created_at": "2026-10-01T00:00:00.000Z",
    "updated_at": "2026-10-05T00:00:00.000Z"
  }
}
```

Nonempty object. Editable fields are min_distance_km, max_distance_km, min_inclusive, max_inclusive, surcharge, currency, is_contact_support and status. The database checks merged range bounds, overlap and support-rule surcharge. Update one bracket carefully to preserve coverage.

Endpoint-specific errors: 400 INVALID_INPUT; 404 NOT_FOUND; 409 OVERLAPPING_RULES.

### Operations and Stripe

#### 22. Process health

**GET /health**

Access: Public.

Request body: none.

Example HTTP 200 response:
```json
{
  "status": "ok"
}
```

Root path, outside /api. Confirms the HTTP process is alive; it does not check database, Google or Stripe configuration.

#### 23. Database readiness

**GET /ready**

Access: Public.

Request body: none.

Example HTTP 200 response:
```json
{
  "status": "ready"
}
```

Root path, outside /api. Checks database connectivity. It does not verify Google/Stripe or all migrations.

Endpoint-specific errors: 503 NOT_READY when the database check fails.

#### 24. Stripe payment notification

**POST /api/payments/stripe/webhook**

Access: Stripe signature.

Request body:
```json
{
  "id": "evt_example_completed",
  "object": "event",
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "id": "cs_example",
      "object": "checkout.session",
      "mode": "payment",
      "payment_status": "paid",
      "amount_total": 14500,
      "currency": "sgd",
      "livemode": false,
      "client_reference_id": "6f75c918-cc55-409a-bb52-95a1739de910",
      "metadata": {
        "booking_id": "BK20261005001",
        "booking_uuid": "6f75c918-cc55-409a-bb52-95a1739de910",
        "customer_name": "John Smith",
        "customer_phone": "+6591234567",
        "customer_email": "john@example.com"
      },
      "payment_intent": "pi_example"
    }
  }
}
```

Required header: Stripe-Signature: <valid signature from Stripe for the unchanged body>.

Example HTTP 200 response:
```json
{
  "received": true
}
```

Stripe calls this server endpoint. Required header: Stripe-Signature generated for this exact raw payload and endpoint signing secret. The body example shows fields the handler uses; real Stripe events contain additional fields. Do not call it from React to mark a booking paid. Unsigned Postman requests return 400 INVALID_SIGNATURE. Match stored booking UUID/client reference, public booking number for new sessions, session ID, amount, currency and test/live mode before applying updates. Amount_total is cents (14500 means SGD 145.00).

Endpoint-specific errors: 400 INVALID_SIGNATURE; 503 PAYMENT_NOT_CONFIGURED; 500 INTERNAL_ERROR for storage/matching failures (logged internally without customer data).

## 5. Quote and checkout behavior

| Driving distance | Default additional charge |
| --- | --- |
| 0 to less than 28 km | SGD 0 |
| 28 to less than 30 km | SGD 5 |
| 30 to less than 32 km | SGD 10 |
| 32 to 35 km inclusive | SGD 15 |
| Greater than 35 km | CONTACT_SUPPORT; no amount or checkout URL |

Rules are editable in the database, so frontend display should use quote.distance_charge. Exact Google meter values select brackets without rounding. A gap in active rules produces 503 DISTANCE_PRICING_UNAVAILABLE; there is no free-distance fallback. Different currencies across fare, selected add-ons and distance rule are rejected. isFrom starting-price fares can be displayed on catalog cards but cannot produce an exact quote or Stripe checkout.

### Hourly quote example

POST /api/booking/quote with an hourly service (example service_id 3):

```json
{
  "vehicle_id": 3,
  "service_id": 3,
  "pickup": {
    "address": "Changi Airport Terminal 1"
  },
  "drop": {
    "address": "Marina Bay Sands"
  },
  "add_ons": [
    {
      "add_on_id": 3,
      "quantity": 1
    }
  ],
  "hours": 3
}
```

Example HTTP 200 response at SGD 65/hour, three hours, 29.4 km and one Baby Seat:

```json
{
  "success": true,
  "quote_status": "AVAILABLE",
  "quote": {
    "vehicle": {
      "id": 3,
      "name": "Toyota Alphard / Vellfire",
      "price": 65
    },
    "service": {
      "id": 3,
      "name": "Hourly",
      "unit": "hour"
    },
    "catalog_id": 14,
    "add_ons": [
      {
        "id": 3,
        "code": "BABY_SEAT",
        "name": "Baby Seat",
        "pricing_type": "FIXED",
        "quantity": 1,
        "unit_price": 20,
        "amount": 20
      }
    ],
    "vehicle_amount": 195,
    "add_on_amount": 20,
    "total_amount": 220,
    "currency": "SGD",
    "route": {
      "pickup": "Changi Airport Terminal 1",
      "drop": "Marina Bay Sands",
      "distance_km": 29.4
    },
    "distance_charge": {
      "rule_id": 2,
      "rule": "[28,30) km",
      "amount": 5
    },
    "distance_amount": 5,
    "hours": 3
  }
}
```


For hourly checkout, add customer and payment_method to that request and retain hours. The same hourly rate/minimum and distance/add-on calculations apply.

Night travel is a customer-selected add-on; this API has no pickup time or automatic time-window logic. Additional-stop quantities price extras, but no intermediate stop addresses are routed. The distance is pickup-to-drop driving distance only.

### Checkout retries

Each new attempt recalculates prices, then saves an immutable quote snapshot. The same Idempotency-Key and normalized payload reuse that snapshot and Stripe session; reordered add-ons and email case normalization do not create a second attempt. A changed payload with the same key returns 409 IDEMPOTENCY_CONFLICT. On PAYMENT_UNAVAILABLE or a network timeout, retry the same attempt with the same key. If no key was supplied, the generated key is returned in the Idempotency-Key response header; a client-generated retained key is safer for a lost response.

Checkout sessions are intended to expire after one hour. Saved sessions can be reopened while pending and unexpired. If no session was saved and fewer than 30 minutes remain, or the attempt is expired, the server returns CHECKOUT_EXPIRED. Start a new attempt/key after expiry or intentional input changes. Nonpending bookings return BOOKING_NOT_PENDING.

### Payment state and webhooks

| Verified Stripe event | Stored booking result |
| --- | --- |
| checkout.session.completed with payment_status paid | PAID |
| checkout.session.completed with payment_status unpaid | Remains PENDING_PAYMENT |
| checkout.session.async_payment_succeeded with payment_status paid | PAID |
| checkout.session.async_payment_failed on pending booking | PAYMENT_FAILED |
| checkout.session.expired on pending booking | PAYMENT_EXPIRED |

Duplicate event IDs are skipped. Distinct success events can each update the row to PAID; the original paid_at is preserved. Failure/expiry events do not downgrade paid bookings. Session and PaymentIntent metadata carry booking_id (public number), booking_uuid (internal UUID), customer_name, customer_phone and customer_email. Browser code must not post a fake event to confirm payment.

There is currently no public booking/payment status GET API. The frontend cannot poll a booking number or session_id through this API to confirm payment. Do not treat the success redirect alone as verified payment; coordinate an authenticated status endpoint with the backend if the success page needs confirmation. Customer scheduling, availability checks, inventory reservation, refunds, email notifications, booking cancellation are not implemented. Admin frontend login is available through POST /api/v1/admin/login; see admin-login.md. No DELETE routes are mounted. POST /api/v1/cab-recommendations was removed and returns 404. The duplicate vehicles array and old nested checkout booking/payment response are no longer returned.

## 6. Common error contract

Failed responses have this shape; details is optional:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "Check passenger and luggage counts.",
    "details": [
      "persons must be an integer between 1 and 100."
    ]
  },
  "requestId": "c9f165a3-8c54-489b-8ea4-748be3a473fa"
}
```

Do not assume every successful response has success:true, and do not treat every HTTP 200 as a quote or payment URL: branch on quote_status for support responses.

| HTTP | Code | Frontend action |
| --- | --- | --- |
| 400 | INVALID_INPUT / INVALID_JSON | Display field details; correct the request |
| 400 | CHECKOUT_NOT_SUPPORTED | Show checkout restriction; backend accepts SGD and defined amount bounds |
| 400 | INVALID_SIGNATURE | Stripe webhook integration error; not a browser checkout response |
| 401 | UNAUTHORIZED | Admin proxy credential missing/invalid |
| 404 | NOT_FOUND | Selection/path no longer valid; refresh catalog |
| 409 | VEHICLE_EXISTS / ALREADY_EXISTS | Show duplicate name/code error in admin UI |
| 409 | OVERLAPPING_RULES | Admin pricing ranges overlap; adjust bounds |
| 409 | QUOTE_UNAVAILABLE | Starting price requires a confirmed/custom fare |
| 409 | IDEMPOTENCY_CONFLICT | Different checkout inputs reused a key; create a new attempt |
| 409 | CHECKOUT_EXPIRED | Create a new attempt/key |
| 409 | BOOKING_NOT_PENDING | Do not reopen this payment attempt |
| 413 | PAYLOAD_TOO_LARGE | Reduce request size (10 KB normally; 64 KB for webhook) |
| 415 | UNSUPPORTED_MEDIA_TYPE | Send Content-Type application/json; check encoding |
| 422 | ROUTE_NOT_FOUND | Ask user to correct pickup/drop addresses |
| 429 | RATE_LIMITED | Reduce/debounce requests and retry according to response headers |
| 500 | INTERNAL_ERROR | Show a generic failure and preserve requestId for support |
| 503 | ADMIN_NOT_CONFIGURED / PAYMENT_NOT_CONFIGURED | Backend deployment configuration required |
| 503 | DISTANCE_UNAVAILABLE | Google key/API, provider error or timeout; show route unavailable |
| 503 | DISTANCE_PRICING_UNAVAILABLE | Backend distance-rule coverage missing; contact support |
| 503 | PAYMENT_UNAVAILABLE | Retry same checkout payload/key; do not create a fresh key automatically |
| 503 | NOT_READY | Database unavailable (readiness endpoint) |

Public/admin endpoints can also return generic storage failures through this error contract. On checkout storage/network failure after a booking/session might have been created, reuse the retained key for safe recovery.

## 7. Postman handoff

Import maxicab-api.postman_collection.json (Postman Collection v2.1). Configure base_url and api_prefix; adjust vehicle_id, service_id, service_code, catalog_id, add-on/type/rule variables from your database. Set admin_api_key only in a private environment for admin calls. idempotency_key defaults to Postman's dynamic {{$guid}} value; replace it with a retained UUID before retrying the same checkout. A dynamically regenerated key does not deduplicate retries. Stripe webhook requests require a real signature; use Stripe's test webhook delivery/CLI rather than executing the unsigned example.

Saved example responses are illustrative and do not execute external services. Admin folder requests change catalog data; use a development/staging backend. Checkout requests create pending bookings and Stripe sessions when configured. Public GETs are read-only.

## 8. Backend configuration and scope

Backend setup requires DATABASE_URL, migrations through 009, GOOGLE_MAPS_API_KEY with Distance Matrix API access, and STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_SUCCESS_URL and STRIPE_CANCEL_URL for checkout. Secrets are never supplied by frontend requests. Stripe redirect URLs are server-configured, not request fields. HTTPS redirects are required in production; localhost HTTP redirects are allowed only outside production.

This guide reflects the repo implementation on 5 October 2026. Endpoint and validation examples have been checked against route/controller/repository code. Google/Stripe response values shown here are examples; sharing this document does not imply a live payment was tested or processed.
