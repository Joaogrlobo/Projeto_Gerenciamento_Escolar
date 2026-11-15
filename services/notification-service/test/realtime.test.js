// Testes da entrega em tempo real por WebSocket.
process.env.JWT_SECRET = 'realtime-test-secret';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');
const notificationsService = require('../src/services/notifications.service');
const { handleMessage } = require('../src/messaging/consumer');
const { createHub } = require('../src/realtime/hub');

const secret = process.env.JWT_SECRET;
const token = (role, options = { expiresIn: '1h' }) => jwt.sign({ role, sub: 1 }, secret, options);

async function startHub(t, options = {}) {
    const server = http.createServer();
    const hub = createHub({ jwtSecret: secret, ...options });
    hub.attach(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        hub.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    return { hub, url: `ws://127.0.0.1:${server.address().port}/ws/notifications` };
}

function collect(socket) {
    const messages = [];
    socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
    return messages;
}

async function connect(url, authToken) {
    const socket = new WebSocket(url);
    const messages = collect(socket);
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'auth', token: authToken }));
    while (!messages.some(message => message.type === 'ready')) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    return { socket, messages };
}

const notification = {
    event_id: 'e1',
    type: 'grade.posted',
    message: 'Nota lançada',
    occurred_at: null,
    received_at: '2026-11-10T00:00:00Z',
    audience: ['admin', 'teacher']
};

test('closes with 4401 when no auth arrives in time', async t => {
    const { url } = await startHub(t, { authTimeoutMs: 50 });
    const socket = new WebSocket(url);
    const [code] = await once(socket, 'close');
    assert.equal(code, 4401);
});

test('closes with 4401 on invalid token', async t => {
    const { url } = await startHub(t);
    const socket = new WebSocket(url);
    await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'auth', token: 'invalido' }));
    const [code] = await once(socket, 'close');
    assert.equal(code, 4401);
});

test('closes with 4401 on malformed first message', async t => {
    const { url } = await startHub(t);
    const socket = new WebSocket(url);
    await once(socket, 'open');
    socket.send('não-json');
    const [code] = await once(socket, 'close');
    assert.equal(code, 4401);
});

test('delivers only to roles in the audience', async t => {
    const { hub, url } = await startHub(t);
    const teacher = await connect(url, token('teacher'));
    const student = await connect(url, token('student'));
    hub.broadcast(notification);
    while (!teacher.messages.some(message => message.type === 'notification')) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(student.messages.some(message => message.type === 'notification'), false);
    teacher.socket.close();
    student.socket.close();
});

test('does not expose audience or payload', async t => {
    const { hub, url } = await startHub(t);
    const admin = await connect(url, token('admin'));
    hub.broadcast({ ...notification, payload: { secret: true } });
    while (!admin.messages.some(message => message.type === 'notification')) {
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    const sent = admin.messages.find(message => message.type === 'notification').notification;
    assert.deepEqual(Object.keys(sent).sort(), ['event_id', 'message', 'occurred_at', 'received_at', 'type']);
    admin.socket.close();
});

test('closes with 4401 when token expires', async t => {
    const { url } = await startHub(t);
    const { socket } = await connect(url, jwt.sign({
        role: 'admin',
        sub: 1,
        exp: Math.floor(Date.now() / 1000) + 2
    }, secret));
    const [code] = await once(socket, 'close');
    assert.equal(code, 4401);
});

function fakeChannel() {
    const calls = { ack: 0, nack: 0, sent: 0 };
    return {
        calls,
        ack() { calls.ack += 1; },
        nack() { calls.nack += 1; },
        sendToQueue() { calls.sent += 1; }
    };
}

const message = { content: Buffer.from('{"id":"e1","type":"grade.posted"}') };

test('duplicate event is acked without live push', async t => {
    t.mock.method(notificationsService, 'recordEvent', async () => null);
    const channel = fakeChannel();
    let pushes = 0;
    await handleMessage(channel, message, () => { pushes += 1; });
    assert.equal(pushes, 0);
    assert.equal(channel.calls.ack, 1);
});

test('new event is pushed after ack', async t => {
    t.mock.method(notificationsService, 'recordEvent', async () => notification);
    const channel = fakeChannel();
    const pushed = [];
    await handleMessage(channel, message, item => pushed.push([item, channel.calls.ack]));
    assert.deepEqual(pushed, [[notification, 1]]);
});

test('live publish failure still acks', async t => {
    t.mock.method(notificationsService, 'recordEvent', async () => notification);
    const channel = fakeChannel();
    const original = console.error;
    console.error = () => {};
    try {
        await handleMessage(channel, message, () => { throw new Error('sem canal'); });
    } finally {
        console.error = original;
    }
    assert.equal(channel.calls.ack, 1);
    assert.equal(channel.calls.sent, 0);
    assert.equal(channel.calls.nack, 0);
});

test('empty audience is not pushed', async t => {
    t.mock.method(notificationsService, 'recordEvent', async () => ({ ...notification, audience: [] }));
    const channel = fakeChannel();
    let pushes = 0;
    await handleMessage(channel, message, () => { pushes += 1; });
    assert.equal(pushes, 0);
    assert.equal(channel.calls.ack, 1);
});
