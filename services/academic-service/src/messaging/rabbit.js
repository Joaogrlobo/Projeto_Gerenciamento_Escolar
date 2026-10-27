// Conexão resiliente, publicação de eventos e worker de médias ponderadas.
const amqp = require('amqplib');
const config = require('../config/env');
const { processGradeEvent } = require('../services/averages.service');

const EXCHANGE = 'distrischool.events';
const QUEUE = 'academic.grade-average';
let connection;
let publisherChannel;
let consumerChannel;
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

function handleConnectionClose(current) {
    if (connection !== current) return;
    connection = null;
    publisherChannel = null;
    consumerChannel = null;
    scheduleReconnect();
}

async function consume(message, channel) {
    if (!message || !channel) return;
    try {
        const event = JSON.parse(message.content.toString('utf8'));
        const result = await processGradeEvent(event);
        channel.ack(message);
        if (result) {
            const { publishEvent } = require('./publisher');
            await publishEvent('average.calculated', result);
        }
    } catch (error) {
        console.error('Falha ao processar evento de nota:', error.message);
        try {
            channel.nack(message, false, false);
        } catch {
            return;
        }
    }
}

async function connect() {
    if (connection || connecting || !config.rabbitmqUrl) {
        if (!config.rabbitmqUrl) console.error('RABBITMQ_URL não configurada');
        return;
    }
    connecting = true;
    let nextConnection;
    try {
        nextConnection = await amqp.connect(config.rabbitmqUrl);
        nextConnection.on('error', error => console.error('RabbitMQ connection error:', error.message));
        nextConnection.on('close', () => handleConnectionClose(nextConnection));

        const nextPublisher = await nextConnection.createConfirmChannel();
        await nextPublisher.assertExchange(EXCHANGE, 'topic', { durable: true });
        nextPublisher.on('error', error => console.error('RabbitMQ publisher channel error:', error.message));
        nextPublisher.on('close', () => handleConnectionClose(nextConnection));

        const nextConsumer = await nextConnection.createChannel();
        await nextConsumer.assertExchange(EXCHANGE, 'topic', { durable: true });
        await nextConsumer.assertQueue(QUEUE, { durable: true });
        await nextConsumer.bindQueue(QUEUE, EXCHANGE, 'grade.*');
        await nextConsumer.prefetch(10);
        nextConsumer.on('error', error => console.error('RabbitMQ consumer channel error:', error.message));
        nextConsumer.on('close', () => {
            if (connection === nextConnection) handleConnectionClose(nextConnection);
        });

        connection = nextConnection;
        publisherChannel = nextPublisher;
        consumerChannel = nextConsumer;
        await nextConsumer.consume(QUEUE, message => consume(message, nextConsumer), { noAck: false });
        console.log('RabbitMQ conectado (academic-service)');
    } catch (error) {
        console.error('RabbitMQ indisponível (academic-service):', error.message);
        if (connection) handleConnectionClose(connection);
        else {
            if (nextConnection) {
                try {
                    await nextConnection.close();
                } catch {
                    // A conexão pode já ter sido encerrada pelo broker.
                }
            }
            scheduleReconnect();
        }
    } finally {
        connecting = false;
    }
}

function publish(routingKey, event) {
    if (!publisherChannel) throw new Error('RabbitMQ não está conectado');
    return new Promise((resolve, reject) => {
        publisherChannel.publish(EXCHANGE, routingKey, Buffer.from(JSON.stringify(event)), {
            persistent: true,
            contentType: 'application/json'
        }, error => error ? reject(error) : resolve());
    });
}

module.exports = { connect, publish };
