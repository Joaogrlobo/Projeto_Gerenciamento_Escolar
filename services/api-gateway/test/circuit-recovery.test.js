// Testa a recuperação do Circuit Breaker depois da janela de espera.
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const http = require('node:http');
const { test } = require('node:test');

test('recovers after reset window', async t => {
    const secret = 'gateway-recovery-secret';
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'HS256' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 60 })}`;
    const token = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
    const auth = { Authorization: `Bearer ${token}` };

    const upstream = http.createServer((req, res) => res.end('{"ok":true}'));
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const { port } = upstream.address();
    await new Promise(resolve => upstream.close(resolve));

    process.env.JWT_SECRET = secret;
    process.env.STUDENT_SERVICE_URL = `http://127.0.0.1:${port}`;
    process.env.CIRCUIT_RESET_MS = '50';
    const app = require('../src/app');
    const gateway = app.listen(0, '127.0.0.1');
    await new Promise(resolve => gateway.once('listening', resolve));
    t.after(async () => {
        gateway.closeAllConnections();
        await new Promise(resolve => gateway.close(resolve));
        upstream.closeAllConnections();
        await new Promise(resolve => upstream.close(resolve));
    });
    const url = `http://127.0.0.1:${gateway.address().port}/api/students`;

    for (let i = 0; i < 5; i += 1) await (await fetch(url, { headers: auth })).text();
    await new Promise(resolve => setTimeout(resolve, 20));
    await new Promise(resolve => upstream.listen(port, '127.0.0.1', resolve));
    await new Promise(resolve => setTimeout(resolve, 80));
    const recovered = await fetch(url, { headers: auth });
    assert.equal(recovered.status, 200);
    await recovered.text();
});
