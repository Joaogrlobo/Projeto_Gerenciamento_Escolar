const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const http = require('node:http');
const { after, before, test } = require('node:test');

const secret = 'gateway-route-test-secret';
let gateway;
let upstream;
let gatewayBaseUrl;

function createToken() {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsignedToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
        sub: 'route-test',
        exp: Math.floor(Date.now() / 1000) + 60
    })}`;
    const signature = createHmac('sha256', secret).update(unsignedToken).digest('base64url');
    return `${unsignedToken}.${signature}`;
}

before(async () => {
    upstream = http.createServer((req, res) => {
        // Simula um serviço com cors() próprio liberando qualquer origem.
        res.writeHead(200, {
            'content-type': 'application/json',
            'access-control-allow-origin': '*'
        });
        res.end(JSON.stringify({ path: req.url }));
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));

    const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
    process.env.JWT_SECRET = secret;
    process.env.CORS_ORIGIN = 'http://app.test';
    process.env.USER_SERVICE_URL = upstreamUrl;
    process.env.STUDENT_SERVICE_URL = upstreamUrl;
    process.env.STAFF_SERVICE_URL = upstreamUrl;
    process.env.ACADEMIC_SERVICE_URL = upstreamUrl;
    process.env.ADMINISTRATIVE_SERVICE_URL = upstreamUrl;
    process.env.NOTIFICATION_SERVICE_URL = upstreamUrl;

    const app = require('../src/app');
    gateway = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => gateway.once('listening', resolve));
    gatewayBaseUrl = `http://127.0.0.1:${gateway.address().port}`;
});

after(async () => {
    if (gateway) {
        gateway.closeAllConnections();
        await new Promise((resolve) => gateway.close(resolve));
    }
    if (upstream) {
        upstream.closeAllConnections();
        await new Promise((resolve) => upstream.close(resolve));
    }
});

test('/api/students is forwarded to student-service as /students', async () => {
    const response = await fetch(`${gatewayBaseUrl}/api/students`, {
        headers: { Authorization: `Bearer ${createToken()}` }
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { path: '/students' });
});

test('gateway CORS policy wins over CORS headers sent by the service', async () => {
    const headers = { Authorization: `Bearer ${createToken()}` };

    const allowed = await fetch(`${gatewayBaseUrl}/api/students`, {
        headers: { ...headers, Origin: 'http://app.test' }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://app.test');

    const denied = await fetch(`${gatewayBaseUrl}/api/students`, {
        headers: { ...headers, Origin: 'http://evil.test' }
    });
    assert.equal(denied.status, 200);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('all mapped /api prefixes are stripped before forwarding', async (t) => {
    const cases = [
        { prefix: '/api/auth', path: '/api/auth/register', expected: '/auth/register', method: 'POST' },
        { prefix: '/api/users', path: '/api/users/example', expected: '/users/example' },
        { prefix: '/api/students', path: '/api/students/example', expected: '/students/example' },
        { prefix: '/api/employees', path: '/api/employees/example', expected: '/employees/example' },
        { prefix: '/api/academic', path: '/api/academic/enrollments', expected: '/enrollments' },
        { prefix: '/api/administrative', path: '/api/administrative/classes', expected: '/classes' },
        { prefix: '/api/notifications', path: '/api/notifications/example', expected: '/notifications/example' }
    ];

    for (const route of cases) {
        await t.test(route.prefix, async () => {
            const headers = route.method === 'POST'
                ? {}
                : { Authorization: `Bearer ${createToken()}` };
            const response = await fetch(`${gatewayBaseUrl}${route.path}`, {
                method: route.method || 'GET',
                headers
            });

            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), { path: route.expected });
        });
    }
});
