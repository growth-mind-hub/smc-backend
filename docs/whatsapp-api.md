# WhatsApp booking confirmation

Admin-triggered Meta WhatsApp Cloud API integration. This endpoint sends a booking confirmation to the customer phone stored on the booking. It does not automatically send on payment or implement Meta's incoming/delivery webhook.

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

Timeouts, rejected requests, crashes and database write failures can leave an attempt UNKNOWN or PENDING. No automatic resend is attempted because Meta may already have accepted the message. An operator must check Meta logs/delivery records before repairing or resetting the attempt in the database. Do not blindly reset a pending attempt while its request may still be running. A delivery webhook and reconciliation workflow can be added separately for automated recovery and delivered/read/failed status tracking.

This API does not change payment status or booking status. Test with Meta's test phone and an authorized test recipient before production. See [Meta messages API](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages) and [WhatsApp messaging policy](https://business.whatsapp.com/policy).
