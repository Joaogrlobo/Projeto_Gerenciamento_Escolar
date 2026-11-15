// Testes do encaminhamento de WebSocket pelo gateway.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const http = require('node:http');
const { after, before, test } = require('node:test');
const WebSocket = require('ws');

let gateway;
let upstream;
let wss;
let baseUrl;

before(async () => {
    upstream = http.createServer();
    wss = new WebSocket.Server({ server: upstream });
    wss.on('connection', (socket, req) => {
        socket.on('message', raw => socket.send(`${req.url}|${raw}`));
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));

    process.env.JWT_SECRET = 'gateway-ws-secret';
    process.env.NOTIFICATION_SERVICE_URL = `http://127.0.0.1:${upstream.address().port}`;
    const app = require('../src/app');
    gateway = app.listen(0, '127.0.0.1');
    gateway.on('upgrade', app.handleUpgrade);
    await new Promise(resolve => gateway.once('listening', resolve));
    baseUrl = `ws://127.0.0.1:${gateway.address().port}`;
});

after(async () => {
    for (const client of wss.clients) client.terminate();
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
});

test('proxies websocket upgrade to notification-service', async () => {
    const socket = new WebSocket(`${baseUrl}/ws/notifications`);
    await once(socket, 'open');
    socket.send('ola');
    const [reply] = await once(socket, 'message');
    assert.equal(reply.toString(), '/ws/notifications|ola');
    socket.terminate();
});

test('destroys upgrades on other paths', async () => {
    const socket = new WebSocket(`${baseUrl}/ws/outra-rota`);
    const [error] = await once(socket, 'error');
    assert.match(error.message, /socket hang up/);
});
