// Consome eventos escolares e delega o registro à camada de serviço.
const notificationsService = require('../services/notifications.service');

const MAX_RETRIES = 5;
const RETRY_QUEUE = 'notification.events.retry';

function logFailure(message, error) {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : undefined;
    console.error(message, ...(code ? [{ code }] : []));
}

function isPermanent(error) {
    return error instanceof SyntaxError || error?.statusCode === 400;
}

function pushLive(notification, publishLive) {
    if (!notification?.audience?.length) return;
    try {
        publishLive(notification);
    } catch (error) {
        logFailure('Failed to publish live notification', error);
    }
}

async function handleMessage(channel, message, publishLive = () => {}) {
    if (!message) return;
    try {
        const event = JSON.parse(message.content.toString('utf8'));
        const notification = await notificationsService.recordEvent(event);
        channel.ack(message);
        pushLive(notification, publishLive);
    } catch (error) {
        const retries = message.properties?.headers?.['x-retry-count'] ?? 0;
        try {
            if (!isPermanent(error) && retries < MAX_RETRIES) {
                logFailure('Notification event processing failed; message will be retried', error);
                channel.sendToQueue(RETRY_QUEUE, message.content, {
                    persistent: true,
                    contentType: 'application/json',
                    headers: { 'x-retry-count': retries + 1 }
                });
                channel.ack(message);
                return;
            }
            logFailure('Notification event processing failed; message will be rejected', error);
            channel.nack(message, false, false);
        } catch (nackError) {
            logFailure('Failed to reject notification event; delivery may be redelivered', nackError);
        }
    }
}

module.exports = { handleMessage, MAX_RETRIES, RETRY_QUEUE };
