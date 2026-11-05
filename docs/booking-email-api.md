# Booking details email (Hostinger SMTP)

Nodemailer sends an HTML and plain-text booking confirmation from `booking@singaporemaxicabs.com.sg` to the stored booking customer email. It includes customer/route/vehicle/service details, booking and payment status, selected add-ons, fare breakdown, card surcharge, total, hours/distance and assigned driver details when available. Pickup date/time is not stored by the current booking API and is not invented in the email. This is a booking confirmation, not a tax invoice.

## Configuration

Add these server-side settings to `.env` (or hosting environment), then restart:

```dotenv
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=booking@singaporemaxicabs.com.sg
SMTP_PASSWORD="your mailbox password"
```

Port 465 uses implicit TLS. Port 587 is also supported and requires STARTTLS. Certificate validation remains enabled. Never put the mailbox password in frontend code or commit it. Ensure Hostinger's domain mail authentication records are configured. The API fails with 503 EMAIL_NOT_CONFIGURED before claiming a send when credentials are missing.

Apply migration 025 with `npm run db:migrate` before using the endpoint. Install dependencies with `npm ci` on deployment.

## Trigger

```sh
curl -X POST "$BASE_URL/api/v1/bookings/BK20261021001/email-confirmation" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Also available under `/api`. Use a booking UUID or number and an admin bearer token/server-side API key. No arbitrary recipient, subject or HTML is accepted. A booking must be PAID, or a CONFIRMED manual booking, and not CANCELLED. A manual booking email states the actual payment status rather than claiming payment was received.

Returns 202 `{ "success": true, "status": "ACCEPTED", "message_id": "..." }` when the SMTP server accepts the email; this is not proof of inbox delivery. Repeated accepted sends return 200 and `duplicate: true`. The unique booking claim prevents concurrent or repeated sends across restarts. Booking deletion cascades to the send record.

400 INVALID_INPUT: invalid request ID/body/customer email. 401 UNAUTHORIZED: missing/invalid admin credentials. 404 NOT_FOUND: missing booking. 409 BOOKING_NOT_CONFIRMED: ineligible booking. 409 EMAIL_SEND_UNCERTAIN: previous send pending/unknown. 502 EMAIL_SEND_UNCERTAIN: SMTP acceptance could not be confirmed.

Unknown and pending sends require operator investigation using Hostinger mail logs before resetting any record or resending: SMTP may already have accepted a message before a timeout/crash. No automatic retries, delivery/bounce tracking, resend endpoint or automatic Stripe-triggered sending are included in this admin-triggered API.
