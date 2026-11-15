// Conexão resiliente ao RabbitMQ e declaração do exchange de eventos.
const amqp = require('amqplib');
const config = require('../config/env');

const EXCHANGE = 'distrischool.events';
const DEAD_LETTER_EXCHANGE = 'distrischool.dlx';
let connection;
let channel;
let connecting = false;
let retryTimer;

function scheduleReconnect() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
    }, 3000);
    retryTimer.unref();
}

function closeQuietly(target) {
    target?.close().catch(() => {
        // A conexão já pode ter sido encerrada pelo broker.
    });
}

async function connect() {
    if (connection || connecting) return;
    connecting = true;
    let nextConnection;
    try {
        nextConnection = await amqp.connect(config.rabbitmqUrl);
        const nextChannel = await nextConnection.createConfirmChannel();
        await nextChannel.assertExchange(EXCHANGE, 'topic', { durable: true });
        await nextChannel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', { durable: true });
        await nextChannel.assertQueue('distrischool.dlq', { durable: true });
        await nextChannel.bindQueue('distrischool.dlq', DEAD_LETTER_EXCHANGE, '#');
        connection = nextConnection;
        channel = nextChannel;
        nextConnection.on('error', error => console.error('RabbitMQ connection error:', error.message));
        nextConnection.on('close', () => {
            connection = null;
            channel = null;
            scheduleReconnect();
        });
        nextChannel.on('error', error => console.error('RabbitMQ channel error:', error.message));
        // Se só o canal cair, fecha a conexão para que o evento 'close' acima reconecte tudo.
        nextChannel.on('close', () => {
            if (channel !== nextChannel) return;
            channel = null;
            closeQuietly(nextConnection);
        });
        console.log('RabbitMQ conectado (student-service)');
    } catch (error) {
        console.error('RabbitMQ indisponível (student-service):', error.message);
        if (nextConnection && connection !== nextConnection) closeQuietly(nextConnection);
        scheduleReconnect();
    } finally {
        connecting = false;
    }
}

function publish(routingKey, event) {
    if (!channel) throw new Error('RabbitMQ não está conectado');
    return new Promise((resolve, reject) => {
        channel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(event)), {
            persistent: true,
            contentType: 'application/json'
        }, error => error ? reject(error) : resolve());
    });
}

module.exports = { connect, publish };
