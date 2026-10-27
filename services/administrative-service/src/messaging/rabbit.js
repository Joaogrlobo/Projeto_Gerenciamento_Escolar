const amqp = require('amqplib');
const config = require('../config/env');

const EXCHANGE = 'distrischool.events';
let connection;
let channel;
let connecting = false;
let retryTimer;

function scheduleReconnect() {
    if (!config.rabbitmqUrl || retryTimer) return;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
    }, 3000);
    retryTimer.unref();
}

async function connect() {
    if (!config.rabbitmqUrl || connection || connecting) return;
    connecting = true;
    try {
        const nextConnection = await amqp.connect(config.rabbitmqUrl);
        const nextChannel = await nextConnection.createConfirmChannel();
        await nextChannel.assertExchange(EXCHANGE, 'topic', { durable: true });
        connection = nextConnection;
        channel = nextChannel;
        nextConnection.on('error', error => console.error('RabbitMQ connection error:', error.message));
        nextConnection.on('close', () => {
            connection = null;
            channel = null;
            scheduleReconnect();
        });
        nextChannel.on('error', error => console.error('RabbitMQ channel error:', error.message));
        nextChannel.on('close', () => {
            channel = null;
            if (connection) {
                connection.close().catch(() => {});
                connection = null;
            }
            scheduleReconnect();
        });
        console.log('RabbitMQ conectado (administrative-service)');
    } catch (error) {
        console.error('RabbitMQ indisponível (administrative-service):', error.message);
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
