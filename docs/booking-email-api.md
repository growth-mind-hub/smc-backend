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

Unknown and pending sends require operator investigation using Hostinger mail logs before resetting any record or resending: SMTP may already have accepted a message before a timeout/crash. No automatic retries of uncertain sends, delivery/bounce tracking or resend endpoint are included.

## Automatic confirmation after Stripe payment

Verified `checkout.session.completed` and `checkout.session.async_payment_succeeded` events with `payment_status: paid` trigger the same deduplicated email after the booking transaction commits. NEW bookings become CONFIRMED when paid; other operational statuses are preserved. Unpaid, expired, failed, mismatched and cancelled bookings do not trigger confirmation email. Admin and automatic triggers share the same email record, so clicking the admin button after automatic acceptance does not send another email. Email status does not change payment success.

Migration 028 removes the booking `pax` and `luggage` columns introduced by migration 027. Checkout and manual booking requests no longer accept those fields. Emails include customer name, fleet and final price including the card surcharge. Fleet capacity fields and recommendation query parameters are unaffected.

SMTP is called after the paid transaction; a configuration/read/claim failure returns an error to Stripe so it can retry the event. Duplicate paid events can retry the notification without reapplying payment. Once a send is claimed, timeouts/crashes or uncertain outcomes leave PENDING/UNKNOWN for operator review rather than risking duplicate mail. An UNKNOWN attempt is logged as `paid_booking_email` without customer details and the webhook is acknowledged. There is no background outbox worker: monitor these logs and reconcile uncertain attempts through Hostinger logs. Ensure SMTP credentials are configured before enabling payment traffic.
