// Consome eventos de nota com nova tentativa para falhas transitórias.
const { processGradeEvent } = require('../services/averages.service');

const MAX_RETRIES = 5;
const RETRY_QUEUE = 'academic.grade-average.retry';

function isPermanent(error) {
    return error instanceof SyntaxError || error?.statusCode === 400;
}

async function handleGradeMessage(channel, message, processEvent = processGradeEvent) {
    if (!message || !channel) return;
    try {
        const event = JSON.parse(message.content.toString('utf8'));
        await processEvent(event);
        channel.ack(message);
    } catch (error) {
        console.error('Falha ao processar evento de nota:', error.message);
        const retries = message.properties?.headers?.['x-retry-count'] ?? 0;
        try {
            if (!isPermanent(error) && retries < MAX_RETRIES) {
                channel.sendToQueue(RETRY_QUEUE, message.content, {
                    persistent: true,
                    contentType: 'application/json',
                    headers: { 'x-retry-count': retries + 1 }
                });
                channel.ack(message);
                return;
            }
            channel.nack(message, false, false);
        } catch {
            // Sem canal, o broker reenviará a mensagem não confirmada.
        }
    }
}

module.exports = { handleGradeMessage, MAX_RETRIES, RETRY_QUEUE };
