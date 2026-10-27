// Esquema SQL de persistência do log de notificações.
module.exports = `CREATE TABLE IF NOT EXISTS event_log (
  event_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;
