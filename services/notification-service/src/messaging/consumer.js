// Consome eventos escolares e delega o registro à camada de serviço.
const notificationsService = require('../services/notifications.service');

function logFailure(message, error) {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : undefined;
    console.error(message, ...(code ? [{ code }] : []));
}

async function handleMessage(channel, message) {
    if (!message) return;
    try {
        const event = JSON.parse(message.content.toString('utf8'));
        await notificationsService.recordEvent(event);
        channel.ack(message);
    } catch (error) {
        logFailure('Notification event processing failed; message will be rejected', error);
        try {
            channel.nack(message, false, false);
        } catch (nackError) {
            logFailure('Failed to reject notification event; delivery may be redelivered', nackError);
        }
    }
}

module.exports = { handleMessage };
