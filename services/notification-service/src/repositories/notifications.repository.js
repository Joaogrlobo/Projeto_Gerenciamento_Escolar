// Consultas SQL parametrizadas do log de notificações.
const { pool } = require('../config/db');

async function insert(event) {
    const { rows } = await pool.query(
        `INSERT INTO event_log(event_id, type, message, payload, occurred_at)
         VALUES($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT(event_id) DO NOTHING
         RETURNING event_id`,
        [event.eventId, event.type, event.message, JSON.stringify(event.payload), event.occurredAt]
    );
    return rows[0] || null;
}

async function list(type, limit) {
    const params = [];
    let sql = 'SELECT event_id, type, message, payload, occurred_at, received_at FROM event_log';
    if (type) {
        params.push(type);
        sql += ' WHERE type = $1';
    }
    params.push(limit);
    sql += ` ORDER BY received_at DESC LIMIT $${params.length}`;
    const { rows } = await pool.query(sql, params);
    return rows;
}

module.exports = { insert, list };
