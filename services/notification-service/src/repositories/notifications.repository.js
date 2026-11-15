// Consultas SQL parametrizadas do log de notificações.
const { pool } = require('../config/db');

async function insert(event) {
    const { rows } = await pool.query(
        `INSERT INTO event_log(event_id, type, message, payload, occurred_at, audience)
         VALUES($1, $2, $3, $4::jsonb, $5, $6)
         ON CONFLICT(event_id) DO NOTHING
         RETURNING event_id, type, message, occurred_at, received_at, audience`,
        [event.eventId, event.type, event.message, JSON.stringify(event.payload), event.occurredAt, event.audience]
    );
    return rows[0] || null;
}

async function list(type, limit, role) {
    const params = [role];
    let sql = `SELECT event_id, type, message, payload, occurred_at, received_at
               FROM event_log WHERE $1 = ANY(audience)`;
    if (type) {
        params.push(type);
        sql += ' AND type = $2';
    }
    params.push(limit);
    sql += ` ORDER BY received_at DESC LIMIT $${params.length}`;
    const { rows } = await pool.query(sql, params);
    return rows;
}

async function countUnread(role, userId) {
    const { rows } = await pool.query(
        `SELECT count(*)::integer AS count FROM event_log
         WHERE $1 = ANY(audience) AND received_at > COALESCE(
             (SELECT seen_at FROM notification_cursors WHERE user_id = $2),
             'epoch'::timestamptz
         )`,
        [role, userId]
    );
    return rows[0].count;
}

async function markSeen(userId) {
    await pool.query(
        `INSERT INTO notification_cursors(user_id, seen_at) VALUES($1, now())
         ON CONFLICT(user_id) DO UPDATE SET seen_at = now()`,
        [userId]
    );
}

module.exports = { insert, list, countUnread, markSeen };
