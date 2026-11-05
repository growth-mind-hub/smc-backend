# WhatsApp booking confirmation

Admin-triggered Meta WhatsApp Cloud API integration. This endpoint sends a booking confirmation to the customer phone stored on the booking. It does not automatically send on payment. Separate webhook handlers receive and store incoming messages and delivery events as described below.

## Setup

1. Configure a Meta WhatsApp business phone number and a production access token with `whatsapp_business_messaging` permission. Keep the token on the server.
2. Create and obtain approval for a utility template named `booking_confirmation` (or set your own name). Use a body with exactly five positional text parameters in this order: customer name, booking number, amount including currency, pickup address, drop address. Example: `Hi {{1}}, your booking {{2}} is confirmed. Booking amount: {{3}}. Pickup: {{4}}. Drop-off: {{5}}.` The message does not claim manual bookings are paid.
3. Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` (a supported Graph API version from your Meta app), `WHATSAPP_CONFIRMATION_TEMPLATE` and `WHATSAPP_TEMPLATE_LANGUAGE` (the exact approved language code). See `.env.example`. This is the phone number ID, not your actual phone number or WhatsApp Business Account ID.
4. Run `npm run db:migrate` to apply migration 023, then restart/deploy the backend.
5. Obtain and retain the customer's WhatsApp opt-in evidence. Passing `whatsapp_opt_in: true` is the authenticated caller's attestation of consent; the API records its timestamp but does not collect that evidence itself.

## Trigger API

`POST /api/v1/bookings/:id/whatsapp-confirmation` (also `/api/bookings/:id/whatsapp-confirmation`). Accepts a booking UUID or booking number. Requires an admin bearer token or server-side admin API key. Call from an authenticated admin/dashboard server; never expose the admin API key in a public frontend. No arbitrary recipient or message text is accepted.

```sh
curl -X POST "$BASE_URL/api/v1/bookings/BK20261021001/whatsapp-confirmation" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"whatsapp_opt_in":true}'
```

The booking must be paid, or a confirmed manual booking, and must not be cancelled. Response `202` means Meta accepted the message, not that it was delivered:

```json
{"success":true,"status":"ACCEPTED","message_id":"wamid..."}
```

Repeating an accepted send returns `200` with `duplicate: true` and the original message ID. A unique database claim prevents concurrent requests and application restarts from issuing another send for the same booking. Booking deletion removes its notification record.

Errors: `400 INVALID_INPUT` for invalid ID/body/phone or missing consent; `401 UNAUTHORIZED`; `404 NOT_FOUND`; `409 BOOKING_NOT_CONFIRMED`; `503 WHATSAPP_NOT_CONFIGURED`; `502 WHATSAPP_SEND_UNCERTAIN` if Meta acceptance cannot be confirmed. Repeating an uncertain or pending send returns `409 WHATSAPP_SEND_UNCERTAIN`.

Timeouts, rejected requests, crashes and database write failures can leave an attempt UNKNOWN or PENDING. No automatic resend is attempted because Meta may already have accepted the message. An operator must check Meta logs/delivery records before repairing or resetting the attempt in the database. Do not blindly reset a pending attempt while its request may still be running. Delivery events are stored in the webhook inbox; automatic reconciliation of send attempts is not implemented.

This API does not change payment status or booking status. Test with Meta's test phone and an authorized test recipient before production. See [Meta messages API](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages) and [WhatsApp messaging policy](https://business.whatsapp.com/policy).

## Meta callback webhook

Apply migration 026 and configure `WHATSAPP_VERIFY_TOKEN` (a strong secret you choose) and `WHATSAPP_APP_SECRET` (Meta App settings > Basic > App secret), then restart the backend. These differ from the WhatsApp API access token. Store the secrets in server environment settings; do not commit them.

Register `https://api.singaporemaxicabs.com.sg/api/v1/whatsapp/webhook` as the Meta callback URL with the matching verification token, then subscribe to the `messages` field. Both `/api` and `/api/v1` aliases are supported. Publish the Meta app to receive production webhook traffic as required by the app dashboard; dashboard test events can be used before publication.

GET verification checks `hub.mode=subscribe` and `hub.verify_token`, then returns `hub.challenge` as plain text with HTTP 200. Invalid verification requests return 403; missing verification configuration returns 503. Test locally after setting WHATSAPP_VERIFY_TOKEN=local-test-token:

```sh
curl -i 'http://localhost:3000/api/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=local-test-token&hub.challenge=123456'
```

POST receives JSON and validates `X-Hub-Signature-256` using HMAC SHA-256 over the exact raw body and the Meta App Secret. Unsigned or tampered requests return 401; malformed JSON/payloads return 400. Meta payloads must use object `whatsapp_business_account` and an entry array. The raw body limit is 256 KB. No admin bearer token is required on these callback endpoints.

Valid incoming messages and delivery updates are stored in `whatsapp_webhook_events.payload` as JSONB before returning `{ "received": true }`. Identical payloads are deduplicated using a SHA-256 payload hash. A failed database write returns 500 for Meta to retry. Delivery statuses are recorded in the inbox, not automatically applied to booking confirmation records. No automated replies or outbound sends occur from this webhook. Out-of-order status updates are retained as events rather than overwriting a current status. Restrict access to this table because it contains customer messages/phone numbers; define retention for your operational needs.

To find status updates for a sent message, inspect the payload's `entry[].changes[].value.statuses[]` and match its `id` to the `message_id` returned by the send API. Incoming messages are in `entry[].changes[].value.messages[]`.
