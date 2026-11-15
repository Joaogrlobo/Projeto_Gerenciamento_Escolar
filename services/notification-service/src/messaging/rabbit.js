// Consumo resiliente de eventos no exchange escolar.
const amqp = require('amqplib');
const config = require('../config/env');
const { handleMessage, RETRY_QUEUE } = require('./consumer');

const EXCHANGE = 'distrischool.events';
const QUEUE = 'notification.events';
const DEAD_LETTER_EXCHANGE = 'distrischool.dlx';
const DEAD_LETTER_QUEUE = 'distrischool.dlq';
const LIVE_EXCHANGE = 'distrischool.live';
let liveHandler = () => {};
let connection = null;
let channel = null;
let connecting = false;
let retryTimer = null;

function logFailure(message, error) {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : undefined;
    console.error(message, ...(code ? [{ code }] : []));
}

function closeAfterError(resource) {
    void (async () => {
        try {
            await resource.close();
        } catch (error) {
            logFailure('Failed to close RabbitMQ resource after AMQP error', error);
        }
    })();
}

function scheduleReconnect() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
    }, 3000);
    retryTimer.unref();
}

function publishLive(notification) {
    channel.publish(LIVE_EXCHANGE, '', Buffer.from(JSON.stringify(notification)));
}

function onLiveMessage(message) {
    if (!message) return;
    try {
        liveHandler(JSON.parse(message.content.toString('utf8')));
    } catch (error) {
        logFailure('Failed to deliver live notification', error);
    }
}

async function connect({ onLive } = {}) {
    if (onLive) liveHandler = onLive;
    if (connection || connecting) return;
    connecting = true;
    let nextConnection;
    let nextChannel;
    try {
        nextConnection = await amqp.connect(config.rabbitmqUrl);
        connection = nextConnection;
        nextConnection.on('error', error => {
            logFailure('RabbitMQ connection error', error);
            if (connection === nextConnection) {
                connection = null;
                channel = null;
            }
            scheduleReconnect();
            closeAfterError(nextConnection);
        });
        nextConnection.on('close', () => {
            if (connection === nextConnection) {
                connection = null;
                channel = null;
            }
            scheduleReconnect();
        });

        nextChannel = await nextConnection.createChannel();
        channel = nextChannel;
        nextChannel.on('error', error => {
            logFailure('RabbitMQ channel error', error);
            if (connection === nextConnection) {
                connection = null;
                channel = null;
            }
            scheduleReconnect();
            closeAfterError(nextConnection);
        });
        nextChannel.on('close', () => {
            if (connection === nextConnection) {
                connection = null;
                channel = null;
            }
            scheduleReconnect();
        });

        await nextChannel.assertExchange(EXCHANGE, 'topic', { durable: true });
        await nextChannel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', { durable: true });
        await nextChannel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
        await nextChannel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, '#');
        await nextChannel.assertQueue(QUEUE, {
            durable: true,
            deadLetterExchange: DEAD_LETTER_EXCHANGE
        });
        await nextChannel.bindQueue(QUEUE, EXCHANGE, '#');
        await nextChannel.assertQueue(RETRY_QUEUE, {
            durable: true,
            messageTtl: 5000,
            deadLetterExchange: '',
            deadLetterRoutingKey: QUEUE
        });
        await nextChannel.prefetch(10);
        await nextChannel.consume(QUEUE, message => handleMessage(nextChannel, message, publishLive), { noAck: false });

        // Cada réplica tem fila própria: o aviso chega a todas, onde quer que o navegador esteja ligado.
        await nextChannel.assertExchange(LIVE_EXCHANGE, 'fanout', { durable: false });
        const liveQueue = await nextChannel.assertQueue('', { exclusive: true, autoDelete: true });
        await nextChannel.bindQueue(liveQueue.queue, LIVE_EXCHANGE, '');
        await nextChannel.consume(liveQueue.queue, onLiveMessage, { noAck: true });

    } catch (error) {
        logFailure('RabbitMQ connection setup failed', error);
        if (connection === nextConnection) {
            connection = null;
            channel = null;
        }
        for (const resource of [nextChannel, nextConnection]) {
            if (!resource) continue;
            try {
                await resource.close();
            } catch (closeError) {
                logFailure('Failed to close RabbitMQ resource after setup failure', closeError);
            }
        }
        scheduleReconnect();
    } finally {
        connecting = false;
    }
}

module.exports = { connect };
