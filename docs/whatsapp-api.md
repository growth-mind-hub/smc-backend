# WhatsApp booking confirmation via Twilio

Outbound WhatsApp now uses Twilio Programmable Messaging, with the same automatic paid-booking trigger and admin endpoint. No additional package or database migration is required for the provider switch. Migration 034 is still required for automatic sending with stored consent. Email sending remains through Hostinger SMTP.

## Server configuration

```dotenv
TWILIO_ACCOUNT_SID=YOUR_ACCOUNT_SID
TWILIO_AUTH_TOKEN=YOUR_NEW_AUTH_TOKEN
TWILIO_WHATSAPP_FROM=whatsapp:+6589536201
TWILIO_WHATSAPP_CONTENT_SID=HX63cc9e9b9f54bb9e846cfb3baf87ee3c
```

Use the newly rotated token: the Basic authorization header previously shared contained a credential. Do not commit the new token. Set it directly in the server .env and restart. The local .env contains non-secret identifiers and a blank token if none was previously configured. Meta access token, phone-number ID, template name and language settings are no longer used for outbound sends. Twilio selects template and language using ContentSid, not the friendly template name booking_confirmation_v2.

## Exact approved ContentVariables mapping

The mapping follows the confirmed booking_confirmation_v2 template, not the earlier sample curl:

| Variable | Stored value or fallback |
| --- | --- |
| 1 | Customer name |
| 2 | Customer phone |
| 3 | Booking reference, SMC or legacy BK |
| 4 | Vehicle name from stored quote |
| 5 | Pickup address |
| 6 | Drop-off address |
| 7 | Itemized fare, distance, add-ons and card surcharge, separated by semicolons |
| 8 | Final amount with two decimals, without SGD prefix |
| 9 | Payment received or payment pending wording |

The configured Twilio ContentSid must refer to the approved nine-variable booking template below. Do not use the earlier sample template with pickup date, driver details and registration. Template variable values are nonempty single-line strings; the cost breakdown uses semicolons. No date/time, pax, bags, flight or registration are sent.

## Sending and automatic triggers

POST /api/v1/bookings/:id/whatsapp-confirmation (also /api), admin bearer authentication, Content-Type application/json, body {"whatsapp_opt_in":true}. Use only after obtaining customer consent. Eligible: PAID bookings, or CONFIRMED manual bookings, excluding cancelled bookings. Recipient always comes from the stored customer phone, with whatsapp: prepended by the backend; requests cannot override it.

Verified paid Stripe checkout.session.completed and checkout.session.async_payment_succeeded events automatically attempt email and WhatsApp independently. Automatic WhatsApp requires stored booking.whatsapp_opt_in=true. Include that optional boolean in checkout only after customer consent. Existing non-consenting bookings are skipped. Creating a pending PayNow booking does not trigger either paid notification.

Twilio is called using POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json with HTTP Basic auth and form-encoded From, To, ContentSid and JSON-string ContentVariables. A valid Twilio SM message SID is stored as message_id. API 202 ACCEPTED means accepted/queued, not delivered. Repeated accepted sends return 200 with duplicate:true. Shared database claims deduplicate automatic and admin sends. Configuration errors return 503 on the admin API; missing automatic configuration fails the Stripe webhook for retry. Rejected, timed-out or otherwise uncertain sends remain UNKNOWN/PENDING for operator review in Twilio Messaging logs before any reset; no blind automatic resend occurs.

## Webhook compatibility

Existing GET/POST /api/v1/whatsapp/webhook handlers are retained for direct Meta callbacks and use Meta challenge/HMAC verification. They do not validate Twilio's X-Twilio-Signature or form-encoded callbacks. Do not configure them as Twilio incoming-message or StatusCallback URLs. This change does not add Twilio inbound/delivery callbacks. Check Twilio Messaging logs for delivered/failed status until a separate Twilio callback integration is added. No StatusCallback is submitted by this sender.

See https://www.twilio.com/docs/whatsapp/quickstart and https://www.twilio.com/docs/content/using-variables-with-content-api.

## Approved template body (booking_confirmation_v2)

```text
Greetings, {{1}}

Thank you for choosing Singapore Maxi Cabs!

Your booking has been confirmed.

Phone: {{2}}
Booking ID: {{3}}
Vehicle: {{4}}
From: {{5}}
To: {{6}}

Cost breakdown:
{{7}}

Total: SGD {{8}}

{{9}}

For assistance, call +65 8800 6006.

Thank you for choosing Singapore Maxi Cabs!
```

Twilio selects this template by TWILIO_WHATSAPP_CONTENT_SID, not its friendly name. Verify that the ContentSid configured in the server belongs to this exact approved template before deploying.
