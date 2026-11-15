// Registra eventos na outbox; o relay os envia ao RabbitMQ depois.
const { randomUUID } = require('node:crypto');
const { pool } = require('../config/db');

async function publishEvent(type, data, database = pool) {
    const event = {
        id: randomUUID(),
        version: 1,
        type,
        occurredAt: new Date().toISOString(),
        source: 'staff-service',
        data
    };
    await database.query(
        'INSERT INTO outbox_events(event_id, type, envelope) VALUES($1, $2, $3::jsonb)',
        [event.id, type, JSON.stringify(event)]
    );
}

module.exports = { publishEvent };
