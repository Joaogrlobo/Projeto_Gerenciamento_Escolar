// Publicador best-effort de eventos do serviço acadêmico.
const { randomUUID } = require('node:crypto');
const { publish } = require('./rabbit');

async function publishEvent(type, data) {
    const event = {
        id: randomUUID(),
        version: 1,
        type,
        occurredAt: new Date().toISOString(),
        source: 'academic-service',
        data
    };
    try {
        await publish(type, event);
    } catch (error) {
        console.error(`Falha ao publicar ${type}:`, error.message);
    }
}

module.exports = { publishEvent };
