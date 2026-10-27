const { randomUUID } = require('node:crypto');
const { publish } = require('./rabbit');

async function publishEvent(type, data) {
    const event = {
        id: randomUUID(),
        type,
        occurredAt: new Date().toISOString(),
        source: 'administrative-service',
        data
    };
    try {
        await publish(type, event);
    } catch (error) {
        console.error(`Falha ao publicar ${type}:`, error.message);
    }
}

module.exports = { publishEvent };
