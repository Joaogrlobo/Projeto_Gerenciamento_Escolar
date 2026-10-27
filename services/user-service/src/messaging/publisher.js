// Monta envelopes de eventos e mantém falhas de mensageria fora do caminho HTTP.
const { randomUUID } = require('node:crypto');
const { publish } = require('./rabbit');

async function publishEvent(type, data) {
    const event = {
        id: randomUUID(),
        type,
        occurredAt: new Date().toISOString(),
        source: 'user-service',
        data
    };
    let timeout;
    try {
        await Promise.race([
            publish(type, event),
            new Promise((resolve, reject) => {
                timeout = setTimeout(() => reject(new Error('timeout publicando evento')), 2000);
                timeout.unref();
            })
        ]);
    } catch (error) {
        console.error(`Falha ao publicar ${type}:`, error.message);
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = { publishEvent };
