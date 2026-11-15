// Testes focados de consumo, topologia DLQ e recuperação RabbitMQ.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const amqp = require('amqplib');
const notificationsService = require('../src/services/notifications.service');
const { handleMessage, MAX_RETRIES, RETRY_QUEUE } = require('../src/messaging/consumer');
const { BadRequestError } = require('../src/errors/AppError');

function captureErrors(run) {
    const original = console.error;
    const entries = [];
    console.error = (...args) => entries.push(args);
    return Promise.resolve()
        .then(run)
        .then(() => entries)
        .finally(() => { console.error = original; });
}

test('nacks failed events without requeue and logs no payload or secrets', async () => {
    const originalRecordEvent = notificationsService.recordEvent;
    notificationsService.recordEvent = async () => {
        const error = new Error('secret=do-not-log event payload');
        error.code = 'EVENT_REJECTED';
        error.statusCode = 400;
        throw error;
    };
    const message = { content: Buffer.from('{"id":"private-id","type":"test"}') };
    let acked = false;
    const nacks = [];
    const channel = {
        ack: () => { acked = true; },
        nack: (...args) => nacks.push(args)
    };

    try {
        const errors = await captureErrors(() => handleMessage(channel, message));
        assert.equal(acked, false);
        assert.deepEqual(nacks, [[message, false, false]]);
        assert.match(errors[0][0], /processing failed/);
        assert.equal(errors[0][1].code, 'EVENT_REJECTED');
        assert.doesNotMatch(JSON.stringify(errors), /secret|do-not-log|private-id|payload/);
    } finally {
        notificationsService.recordEvent = originalRecordEvent;
    }
});

test('logs nack failures without exposing error details', async () => {
    const originalRecordEvent = notificationsService.recordEvent;
    notificationsService.recordEvent = async () => {
        throw Object.assign(new Error('secret payload'), { statusCode: 400 });
    };
    const message = { content: Buffer.from('{"id":"private-id","type":"test"}') };
    const channel = { ack() {}, nack() { throw new Error('amqp://user:password@host'); } };

    try {
        const errors = await captureErrors(() => handleMessage(channel, message));
        assert.equal(errors.length, 2);
        assert.match(errors[1][0], /Failed to reject/);
        assert.doesNotMatch(JSON.stringify(errors), /secret|password|private-id|payload/);
    } finally {
        notificationsService.recordEvent = originalRecordEvent;
    }
});

test('declares durable dead-letter topology and reconnects after AMQP errors', async () => {
    const originalConnect = amqp.connect;
    const originalSetTimeout = global.setTimeout;
    const connections = [];
    const scheduled = [];

    class FakeChannel extends EventEmitter {
        constructor() {
            super();
            this.declarations = [];
        }
        async assertExchange(...args) { this.declarations.push(['exchange', ...args]); }
        async assertQueue(...args) {
            this.declarations.push(['queue', ...args]);
            return { queue: args[0] || 'amq.gen-live' };
        }
        async bindQueue(...args) { this.declarations.push(['bind', ...args]); }
        async prefetch(...args) { this.declarations.push(['prefetch', ...args]); }
        async consume(...args) { this.declarations.push(['consume', ...args]); }
        async close() {}
    }

    class FakeConnection extends EventEmitter {
        constructor() {
            super();
            this.channel = new FakeChannel();
        }
        async createChannel() { return this.channel; }
        async close() {}
    }

    amqp.connect = async () => {
        const connection = new FakeConnection();
        connections.push(connection);
        return connection;
    };
    global.setTimeout = (callback, delay) => {
        const timer = { callback, delay, unref() {} };
        scheduled.push(timer);
        return timer;
    };

    try {
        const errors = await captureErrors(async () => {
            const { connect } = require('../src/messaging/rabbit');
            await connect();
            const channel = connections[0].channel;
            assert.deepEqual(channel.declarations, [
                ['exchange', 'distrischool.events', 'topic', { durable: true }],
                ['exchange', 'distrischool.dlx', 'topic', { durable: true }],
                ['queue', 'distrischool.dlq', { durable: true }],
                ['bind', 'distrischool.dlq', 'distrischool.dlx', '#'],
                ['queue', 'notification.events', {
                    durable: true,
                    deadLetterExchange: 'distrischool.dlx'
                }],
                ['bind', 'notification.events', 'distrischool.events', '#'],
                ['queue', 'notification.events.retry', {
                    durable: true,
                    messageTtl: 5000,
                    deadLetterExchange: '',
                    deadLetterRoutingKey: 'notification.events'
                }],
                ['prefetch', 10],
                ['consume', 'notification.events', channel.declarations[8][2], { noAck: false }],
                ['exchange', 'distrischool.live', 'fanout', { durable: false }],
                ['queue', '', { exclusive: true, autoDelete: true }],
                ['bind', 'amq.gen-live', 'distrischool.live', ''],
                ['consume', 'amq.gen-live', channel.declarations[12][2], { noAck: true }]
            ]);

            connections[0].emit('error', Object.assign(
                new Error('amqp://user:secret@broker'),
                { code: 'ECONNRESET' }
            ));
            assert.equal(scheduled.length, 1);
            assert.equal(scheduled[0].delay, 3000);
            scheduled[0].callback();
            await new Promise(resolve => originalSetTimeout(resolve, 0));
            assert.equal(connections.length, 2);

            connections[1].channel.emit('error', new Error('channel secret'));
            assert.equal(scheduled.length, 2);
        });
        assert.match(errors[0][0], /connection error/);
        assert.equal(errors[0][1].code, 'ECONNRESET');
        assert.match(errors[1][0], /channel error/);
        assert.doesNotMatch(JSON.stringify(errors), /secret|password|broker/);
    } finally {
        amqp.connect = originalConnect;
        global.setTimeout = originalSetTimeout;
    }
});

function fakeChannel() {
    const calls = { ack: 0, nack: [], sent: [] };
    return {
        calls,
        ack() { calls.ack += 1; },
        nack(...args) { calls.nack.push(args); },
        sendToQueue(...args) { calls.sent.push(args); }
    };
}

async function withRecordEvent(implementation, run) {
    const original = notificationsService.recordEvent;
    notificationsService.recordEvent = implementation;
    try {
        await captureErrors(run);
    } finally {
        notificationsService.recordEvent = original;
    }
}

test('sends transient failure to retry queue with incremented count', async () => {
    const message = {
        content: Buffer.from('{"id":"a","type":"t"}'),
        properties: { headers: { 'x-retry-count': 2 } }
    };
    const channel = fakeChannel();
    await withRecordEvent(async () => { throw new Error('db down'); }, () => handleMessage(channel, message));
    assert.equal(RETRY_QUEUE, 'notification.events.retry');
    assert.equal(channel.calls.sent.length, 1);
    assert.equal(channel.calls.sent[0][0], RETRY_QUEUE);
    assert.equal(channel.calls.sent[0][1], message.content);
    assert.equal(channel.calls.sent[0][2].headers['x-retry-count'], 3);
    assert.equal(channel.calls.sent[0][2].persistent, true);
    assert.equal(channel.calls.ack, 1);
    assert.equal(channel.calls.nack.length, 0);
});

test('dead-letters transient failure after MAX_RETRIES', async () => {
    const message = {
        content: Buffer.from('{"id":"a","type":"t"}'),
        properties: { headers: { 'x-retry-count': MAX_RETRIES } }
    };
    const channel = fakeChannel();
    await withRecordEvent(async () => { throw new Error('db down'); }, () => handleMessage(channel, message));
    assert.equal(MAX_RETRIES, 5);
    assert.deepEqual(channel.calls.nack, [[message, false, false]]);
    assert.equal(channel.calls.sent.length, 0);
    assert.equal(channel.calls.ack, 0);
});

test('dead-letters permanent failure immediately', async () => {
    const message = { content: Buffer.from('{"id":"a","type":"t"}') };
    const channel = fakeChannel();
    await withRecordEvent(async () => { throw new BadRequestError('evento inválido'); }, () => handleMessage(channel, message));
    assert.deepEqual(channel.calls.nack, [[message, false, false]]);
    assert.equal(channel.calls.sent.length, 0);
});

test('dead-letters malformed JSON immediately', async () => {
    const message = { content: Buffer.from('não-json') };
    const channel = fakeChannel();
    await captureErrors(() => handleMessage(channel, message));
    assert.deepEqual(channel.calls.nack, [[message, false, false]]);
    assert.equal(channel.calls.sent.length, 0);
});
