# Booking checkout

`POST /api/bookings/checkout` recalculates the vehicle fare, driving-distance charge and selected add-ons, saves their price snapshots, and creates a Stripe-hosted Checkout session. `/api/v1/bookings/checkout` works identically. Checkout creates a booking in `PENDING_PAYMENT`; a verified Stripe payment event changes it to `PAID`.

## Setup

Run `npm run db:migrate` to apply migration 009 (`bookings`, `booking_add_ons`, `stripe_webhook_events`, and the booking-number sequence). Existing fleet and prices are preserved.

Configure these server environment variables, then restart the server:

```dotenv
GOOGLE_MAPS_API_KEY=your_google_distance_matrix_key
STRIPE_SECRET_KEY=your_stripe_test_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_signing_secret
STRIPE_SUCCESS_URL=https://your-frontend.example/booking/success?session_id={CHECKOUT_SESSION_ID}
STRIPE_CANCEL_URL=https://your-frontend.example/booking/cancel
```

Use Stripe test credentials during development. Redirect URLs are configured by the backend; requests cannot override them. HTTPS is required in production. HTTP localhost redirects are allowed outside production. Missing Stripe credentials, webhook secret or invalid redirects return 503 `PAYMENT_NOT_CONFIGURED` before saving a booking.

Register `POST /api/payments/stripe/webhook` (or `/api/v1/payments/stripe/webhook`) in Stripe for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, and `checkout.session.expired`.

For local forwarding:

```sh
stripe listen --forward-to localhost:3000/api/payments/stripe/webhook
```

Use the listener's signing secret for local verification. Hosted endpoints use their own Dashboard signing secret. See [Stripe signature verification](https://docs.stripe.com/webhooks/signature). The code verifies the unmodified request body before applying an event. Browser redirects do not mark bookings paid.

## Paid invoice emails

New Stripe Checkout sessions enable `invoice_creation: { enabled: true }` and pass the booking customer email as `customer_email`. In Stripe Dashboard, open Settings > Business > Customer emails and enable Successful payments. After successful payment, Stripe emails an invoice summary with links to the invoice and receipt PDFs. Complete the public business details and branding in Stripe before going live.

Deploy/restart the backend and create a new checkout attempt to use this setting; existing sessions are reused on retries and are not updated. Test payments do not automatically send receipt emails: inspect the generated invoice in Stripe and send a test receipt manually. No additional webhook is required for Stripe to send the email. One-time post-payment invoices have separate Stripe pricing. See [Stripe paid invoice documentation](https://docs.stripe.com/receipts#paid-invoice-receipts).

## Postman request

Set `Content-Type: application/json`. No admin token is needed. Set `Idempotency-Key` to a new UUID for each customer checkout attempt and reuse it for retries of that attempt.

```json
{
  "customer": {
    "name": "John Smith",
    "email": "john@example.com",
    "phone": "+6591234567"
  },
  "vehicle_id": 3,
  "service_id": 1,
  "pickup": { "address": "Changi Airport Terminal 1" },
  "drop": { "address": "Marina Bay Sands" },
  "add_ons": [
    { "add_on_id": 2, "quantity": 1 },
    { "add_on_id": 3, "quantity": 1 },
    { "add_on_id": 4, "quantity": 2 }
  ],
  "payment_method": "STRIPE"
}
```

Use actual catalog IDs. Phone must start with `+` followed by 7 to 15 digits. Email must be valid; name must contain 1 to 150 characters. Unknown fields are rejected. Do not send `amount`, `currency`, prices, distance or surcharge: they return 400. Hourly services also require `hours`, meeting the configured minimum. Other quote validations continue to apply.

An $80 vehicle, 29.4 km route, $20 Meet & Greet, $20 Baby Seat and two $10 stops total **$145**, not $125. Actual Google distance and database rates determine the amount. Stripe checkout currently accepts SGD totals from $0.50 to $999,999.99 and offers card payments.

Example response:

```json
{
  "success": true,
  "booking_id": "BK20261003001",
  "payment_status": "PENDING",
  "amount": 145,
  "currency": "SGD",
  "stripe_checkout_url": "https://checkout.stripe.com/..."
}
```

Stripe receives the saved total in integer cents and `customer_email`. Session and PaymentIntent metadata include `booking_id` (the public booking number), `booking_uuid` (internal correlation ID), `customer_name`, `customer_phone`, and `customer_email`. Customer details are also stored in PostgreSQL. The API response remains free of customer information. Coupons, automatic tax and dynamic currency conversion are not enabled. Logs omit customer data and secrets. Redirect destinations come from `STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL`.

The response now uses flat fields: `booking_id`, `payment_status`, `amount`, `currency` and `stripe_checkout_url`. The database still stores `PENDING_PAYMENT`; the API presents it as `PENDING`. Frontend clients using the previous nested `booking`/`payment` response must switch to these fields.

Contact-support routes return `CONTACT_SUPPORT` without saving a booking or creating a payment URL. Starting-price fares cannot create checkout sessions. No inventory reservation, pickup-time scheduling, dispatch, refunds or email notifications are implemented by this endpoint.

## Retries and payment updates

The optional `Idempotency-Key` header accepts 8 to 128 letters, digits, underscores or hyphens; UUIDs are recommended. If omitted, the backend generates a key and returns it in the response header, including payment failures. The frontend should retain its own key to handle network failure before a response arrives. Keep keys private.

Repeated requests with the same key and normalized details reuse the saved booking, price snapshot and Stripe session. Reordering add-ons does not create a new attempt. Changed details return 409 `IDEMPOTENCY_CONFLICT`. Stripe calls use a stable key derived from the booking UUID. If Stripe times out after saving a booking, retry with the same key; a new key creates another booking.

Attempts expire after one hour. If no session was saved and less than 30 minutes remain, start a new attempt with a new key. Paid, failed or expired bookings cannot be checked out again under the same key. Booking numbers use the Singapore date and a persistent sequence (which does not reset daily and may have gaps).

Webhook updates require a valid signature, matching booking UUID/client reference, session ID (once known), currency, live/test mode (once known), and total. Completed sessions with `payment_status: unpaid` stay pending. Paid sessions become `PAID`; expiration changes pending bookings to `PAYMENT_EXPIRED`; async failure changes them to `PAYMENT_FAILED`. Event IDs are processed once. Delayed events cannot downgrade paid bookings. Unknown unrelated events are acknowledged and ignored. Mismatched payments leave bookings unchanged and return an error. See [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment).

Checkout responses use `Cache-Control: no-store`. There is no public customer/booking lookup endpoint. Status is stored in PostgreSQL; an authenticated status endpoint is a separate feature.
