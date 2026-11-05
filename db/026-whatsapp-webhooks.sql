CREATE TABLE whatsapp_webhook_events (
  payload_hash TEXT PRIMARY KEY CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
