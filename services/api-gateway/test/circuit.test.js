// Testes do Circuit Breaker por serviço no gateway.
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const http = require('node:http');
const { after, before, test } = require('node:test');

const secret = 'gateway-circuit-test-secret';
let gateway;
let upstream;
let baseUrl;
let upstreamHits = 0;
let lastBody = null;

function createToken() {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
        sub: 'circuit-test',
        exp: Math.floor(Date.now() / 1000) + 60
    })}`;
    return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
}

const headers = () => ({ Authorization: `Bearer ${createToken()}` });

async function freePort() {
    const server = http.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function circuitOf(service) {
    const health = await (await fetch(`${baseUrl}/health/services`)).json();
    return health.services[service].circuit;
}

async function waitForCircuit(service, expected) {
    for (let i = 0; i < 50; i += 1) {
        if (await circuitOf(service) === expected) return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(await circuitOf(service), expected);
}

before(async () => {
    upstream = http.createServer((req, res) => {
        upstreamHits += req.url.startsWith('/users') ? 1 : 0;
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            if (req.url.startsWith('/users')) {
                res.writeHead(503, { 'content-type': 'application/json' });
                return res.end('{"error":"dependencia indisponivel"}');
            }
            lastBody = Buffer.concat(chunks).toString();
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{"ok":true}');
        });
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

    process.env.JWT_SECRET = secret;
    process.env.USER_SERVICE_URL = upstreamUrl;
    process.env.STUDENT_SERVICE_URL = `http://127.0.0.1:${await freePort()}`;
    process.env.STAFF_SERVICE_URL = upstreamUrl;
    process.env.ACADEMIC_SERVICE_URL = upstreamUrl;
    process.env.ADMINISTRATIVE_SERVICE_URL = upstreamUrl;
    process.env.NOTIFICATION_SERVICE_URL = upstreamUrl;

    const app = require('../src/app');
    gateway = app.listen(0, '127.0.0.1');
    await new Promise(resolve => gateway.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${gateway.address().port}`;
});

after(async () => {
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
});

test('opens after connection failures and short-circuits', async () => {
    for (let i = 0; i < 5; i += 1) {
        const failed = await fetch(`${baseUrl}/api/students`, { headers: headers() });
        assert.equal(failed.status, 503);
        await failed.text();
    }
    await waitForCircuit('student-service', 'OPEN');
    const open = await fetch(`${baseUrl}/api/students`, { headers: headers() });
    assert.equal(open.status, 503);
    assert.equal(open.headers.get('retry-after'), '10');
    assert.deepEqual(await open.json(), { error: 'Serviço temporariamente indisponível' });
});

test('upstream 503 responses never open the circuit', async () => {
    for (let i = 0; i < 10; i += 1) {
        const response = await fetch(`${baseUrl}/api/users`, { headers: headers() });
        assert.equal(response.status, 503);
        await response.text();
    }
    assert.equal(upstreamHits, 10);
    assert.equal(await circuitOf('user-service'), 'CLOSED');
});

test('POST body reaches upstream intact through the breaker', async () => {
    const payload = JSON.stringify({ name: 'Ana', notes: 'x'.repeat(5000) });
    const response = await fetch(`${baseUrl}/api/employees`, {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: payload
    });
    assert.equal(response.status, 200);
    assert.equal(lastBody, payload);
});

test('health/services reports circuit state', async () => {
    assert.equal(await circuitOf('staff-service'), 'CLOSED');
});
