import { randomUUID } from 'node:crypto';

const failure = (code, message) => Object.assign(new Error(message), { code });
const supportedEvents = ['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired'];

export function bookingRepository(pool, transaction) {
  const getByKey = async (key, client = pool) => (await client.query('SELECT * FROM bookings WHERE idempotency_key = $1', [key])).rows[0] ?? null;
  return {
    saveWhatsappWebhook: async (hash, payload) => pool.query(`INSERT INTO whatsapp_webhook_events (payload_hash, payload)
      VALUES ($1, $2::jsonb) ON CONFLICT (payload_hash) DO NOTHING`, [hash, JSON.stringify(payload)]),
    claimEmailConfirmation: async id => (await pool.query(`INSERT INTO booking_email_confirmations (booking_id)
      VALUES ($1) ON CONFLICT (booking_id) DO NOTHING RETURNING booking_id`, [id])).rowCount === 1,
    getEmailConfirmation: async id => (await pool.query(
      'SELECT status, message_id FROM booking_email_confirmations WHERE booking_id = $1', [id])).rows[0] ?? null,
    finishEmailConfirmation: async (id, status, messageId) => pool.query(`UPDATE booking_email_confirmations
      SET status = $2, message_id = $3, updated_at = CURRENT_TIMESTAMP WHERE booking_id = $1`, [id, status, messageId]),
    claimWhatsappConfirmation: async id => (await pool.query(`INSERT INTO booking_whatsapp_confirmations (booking_id)
      VALUES ($1) ON CONFLICT (booking_id) DO NOTHING RETURNING booking_id`, [id])).rowCount === 1,
    getWhatsappConfirmation: async id => (await pool.query(
      'SELECT status, message_id FROM booking_whatsapp_confirmations WHERE booking_id = $1', [id])).rows[0] ?? null,
    finishWhatsappConfirmation: async (id, status, messageId) => pool.query(`UPDATE booking_whatsapp_confirmations
      SET status = $2, message_id = $3, updated_at = CURRENT_TIMESTAMP WHERE booking_id = $1`, [id, status, messageId]),
    listBookings: async (limit, offset) => (await pool.query(
      'SELECT * FROM bookings ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2', [limit, offset])).rows,
    getBooking: async id => (await pool.query(
      'SELECT * FROM bookings WHERE id::text = lower($1) OR booking_number = $1', [id])).rows[0] ?? null,
    updateBooking: async (id, body) => (await pool.query(`UPDATE bookings SET
      booking_status = COALESCE($2, booking_status),
      driver_name = COALESCE($3, driver_name),
      driver_phone = COALESCE($4, driver_phone)
      WHERE id::text = lower($1) OR booking_number = $1 RETURNING *`,
    [id, body.booking_status ?? null, body.driver_name ?? null, body.driver_phone ?? null])).rows[0] ?? null,
    deleteBooking: id => transaction(async client => {
      const booking = (await client.query(
        'SELECT id FROM bookings WHERE id::text = lower($1) OR booking_number = $1 FOR UPDATE', [id])).rows[0];
      if (!booking) { return false; }
      await client.query('DELETE FROM booking_add_ons WHERE booking_id = $1', [booking.id]);
      await client.query('DELETE FROM stripe_webhook_events WHERE booking_id = $1', [booking.id]);
      await client.query('DELETE FROM bookings WHERE id = $1', [booking.id]);
      return true;
    }),
    getCheckoutByKey: getByKey,
    createCheckoutBooking: (input, quote, key, requestHash, { manual = false } = {}) => transaction(async client => {
      const { rows } = await client.query(`INSERT INTO bookings
        (id, idempotency_key, request_hash, customer_name, customer_email, customer_phone,
        vehicle_id, service_id, catalog_id, pickup_address, drop_address, distance_meters, hours,
        vehicle_amount_minor, distance_amount_minor, add_on_amount_minor, total_amount_minor, currency, quote_snapshot,
        payment_method, booking_status, driver_name, driver_phone, card_surcharge_minor)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
      [randomUUID(), key, requestHash, input.customer.name, input.customer.email, input.customer.phone,
        input.vehicle_id, input.service_id, quote.catalog_id, input.pickup.address, input.drop.address,
        Math.round(quote.route.distance_km * 1000), input.hours ?? null,
        Math.round(quote.vehicle_amount * 100), Math.round(quote.distance_amount * 100), Math.round(quote.add_on_amount * 100),
        Math.round(quote.total_amount * 100), quote.currency, JSON.stringify(quote),
        manual ? 'MANUAL' : 'STRIPE', manual ? 'CONFIRMED' : 'NEW',
        manual ? input.driver_name ?? '' : '', manual ? input.driver_phone ?? '' : '',
        manual ? 0 : Math.round((quote.card_surcharge_amount ?? 0) * 100)]);
      const booking = rows[0] ?? await getByKey(key, client);
      if (booking.request_hash !== requestHash) { throw failure('IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for different booking details.'); }
      if (rows.length) {
        for (const item of quote.add_ons) {
          await client.query(`INSERT INTO booking_add_ons
            (booking_id, add_on_id, add_on_code, add_on_name, pricing_type, quantity, unit_price_minor, total_price_minor)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [booking.id, item.id, item.code, item.name, item.pricing_type, item.quantity,
            Math.round(item.unit_price * 100), Math.round(item.amount * 100)]);
        }
      }
      return booking;
    }),
    saveCheckoutSession: async (id, session) => {
      const { rows } = await pool.query(`UPDATE bookings SET stripe_session_id = $2,
        stripe_checkout_url = $3, stripe_livemode = $4, checkout_expires_at = to_timestamp($5)
        WHERE id = $1 AND (stripe_session_id IS NULL OR stripe_session_id = $2) RETURNING *`,
      [id, session.id, session.url, session.livemode, session.expires_at]);
      if (!rows.length) { throw failure('PAYMENT_MISMATCH', 'Stripe session does not match the booking.'); }
      return rows[0];
    },
    applyStripeEvent: event => transaction(async client => {
      if (!supportedEvents.includes(event.type)) { return { ignored: true }; }
      const session = event.data?.object;
      // Older sessions stored the internal UUID directly in booking_id.
      const id = session?.metadata?.booking_uuid ?? session?.metadata?.booking_id;
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) { return { ignored: true }; }
      const booking = (await client.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!booking) { return { ignored: true }; }
      if (booking.payment_method === 'MANUAL') { return { ignored: true }; }
      if (!session.id || session.mode !== 'payment' || session.client_reference_id !== id ||
        (session.metadata.booking_uuid && session.metadata.booking_id !== booking.booking_number) ||
        session.amount_total !== Number(booking.total_amount_minor) || session.currency?.toUpperCase() !== booking.currency ||
        (booking.stripe_session_id && booking.stripe_session_id !== session.id) ||
        typeof session.livemode !== 'boolean' || (booking.stripe_livemode !== null && booking.stripe_livemode !== session.livemode)) {
        throw failure('PAYMENT_MISMATCH', 'Stripe payment does not match the stored booking.');
      }
      const receipt = await client.query(`INSERT INTO stripe_webhook_events (id, booking_id, event_type)
        VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [event.id, id, event.type]);
      if (!receipt.rowCount) { return { duplicate: true }; }
      let status = booking.status;
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && session.payment_status === 'paid') { status = 'PAID'; }
      else if (booking.status === 'PENDING_PAYMENT' && event.type === 'checkout.session.expired') { status = 'PAYMENT_EXPIRED'; }
      else if (booking.status === 'PENDING_PAYMENT' && event.type === 'checkout.session.async_payment_failed') { status = 'PAYMENT_FAILED'; }
      // A paid booking cannot be downgraded by delayed or replayed events.
      await client.query(`UPDATE bookings SET status = $2, stripe_session_id = $3, stripe_livemode = $4,
        stripe_payment_intent_id = COALESCE($5, stripe_payment_intent_id),
        paid_at = CASE WHEN $2 = 'PAID' THEN COALESCE(paid_at, CURRENT_TIMESTAMP) ELSE paid_at END
        WHERE id = $1`,
      [id, status, session.id, session.livemode,
        typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null]);
      return { status };
    }),
  };
}
