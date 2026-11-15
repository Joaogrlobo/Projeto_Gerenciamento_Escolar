// Esquema SQL de persistência do log de notificações.
module.exports = `CREATE TABLE IF NOT EXISTS event_log (
  event_id TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE event_log ADD COLUMN IF NOT EXISTS audience TEXT[] NOT NULL DEFAULT '{admin}';
UPDATE event_log SET audience = '{}' WHERE type = 'user.logged' AND audience <> '{}';

CREATE TABLE IF NOT EXISTS notification_cursors (
  user_id INTEGER PRIMARY KEY,
  seen_at TIMESTAMPTZ NOT NULL
);`;
