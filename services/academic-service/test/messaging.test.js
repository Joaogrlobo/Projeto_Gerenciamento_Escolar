// Testes do consumidor de notas: retry, dead-letter e topologia.
process.env.RABBITMQ_URL = 'amqp://test';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const amqp = require('amqplib');
const { handleGradeMessage, MAX_RETRIES, RETRY_QUEUE } = require('../src/messaging/consumer');
const { BadRequestError } = require('../src/errors/AppError');
const { processGradeEvent } = require('../src/services/averages.service');

function fakeChannel() {
    const calls = { ack: 0, nack: [], sent: [] };
    return {
        calls,
        ack() { calls.ack += 1; },
        nack(...args) { calls.nack.push(args); },
        sendToQueue(...args) { calls.sent.push(args); }
    };
}

const silence = async run => {
    const original = console.error;
    console.error = () => {};
    try { await run(); } finally { console.error = original; }
};

const content = Buffer.from('{"id":"a","type":"grade.posted"}');

test('sends transient failure to retry queue with incremented count', async () => {
    const message = { content, properties: { headers: { 'x-retry-count': 2 } } };
    const channel = fakeChannel();
    await silence(() => handleGradeMessage(channel, message, async () => { throw new Error('db down'); }));
    assert.equal(RETRY_QUEUE, 'academic.grade-average.retry');
    assert.equal(channel.calls.sent[0][0], RETRY_QUEUE);
    assert.equal(channel.calls.sent[0][2].headers['x-retry-count'], 3);
    assert.equal(channel.calls.ack, 1);
    assert.equal(channel.calls.nack.length, 0);
});

test('dead-letters transient failure after MAX_RETRIES', async () => {
    const message = { content, properties: { headers: { 'x-retry-count': MAX_RETRIES } } };
    const channel = fakeChannel();
    await silence(() => handleGradeMessage(channel, message, async () => { throw new Error('db down'); }));
    assert.equal(MAX_RETRIES, 5);
    assert.deepEqual(channel.calls.nack, [[message, false, false]]);
    assert.equal(channel.calls.sent.length, 0);
});

test('dead-letters permanent failure immediately', async () => {
    const message = { content };
    const channel = fakeChannel();
    await silence(() => handleGradeMessage(channel, message, async () => { throw new BadRequestError('inválido'); }));
    assert.deepEqual(channel.calls.nack, [[message, false, false]]);
    assert.equal(channel.calls.sent.length, 0);
});

test('dead-letters malformed JSON immediately', async () => {
    const message = { content: Buffer.from('não-json') };
    const channel = fakeChannel();
    await silence(() => handleGradeMessage(channel, message, async () => null));
    assert.deepEqual(channel.calls.nack, [[message, false, false]]);
});

test('invalid grade event is a permanent failure', async () => {
    await assert.rejects(processGradeEvent({ id: 'x', type: 'other.event' }), { statusCode: 400 });
});

test('declares academic queue with dead-letter exchange and retry queue', async () => {
    const original = amqp.connect;
    const declarations = [];
    class FakeChannel extends EventEmitter {
        async assertExchange() {}
        async assertQueue(...args) { declarations.push(args); }
        async bindQueue() {}
        async prefetch() {}
        async consume() {}
    }
    class FakeConnection extends EventEmitter {
        async createChannel() { return new FakeChannel(); }
        async createConfirmChannel() { return new FakeChannel(); }
        async close() {}
    }
    amqp.connect = async () => new FakeConnection();
    try {
        const { connect } = require('../src/messaging/rabbit');
        const log = console.log;
        console.log = () => {};
        await connect();
        console.log = log;
        assert.deepEqual(declarations.find(([name]) => name === 'academic.grade-average'), [
            'academic.grade-average',
            { durable: true, deadLetterExchange: 'distrischool.dlx' }
        ]);
        assert.deepEqual(declarations.find(([name]) => name === RETRY_QUEUE), [
            RETRY_QUEUE,
            { durable: true, messageTtl: 5000, deadLetterExchange: '', deadLetterRoutingKey: 'academic.grade-average' }
        ]);
        assert.ok(declarations.find(([name]) => name === 'distrischool.dlq'));
    } finally {
        amqp.connect = original;
    }
});
