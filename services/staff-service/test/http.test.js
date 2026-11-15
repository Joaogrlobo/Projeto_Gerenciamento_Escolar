// Testes HTTP de validação: id não numérico e JSON malformado devem gerar 400, não 500.
process.env.JWT_SECRET = 'staff-service-test-secret';

const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const app = require('../src/app');

async function startServer(t) {
    const server = app.listen(0);
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    return `http://127.0.0.1:${server.address().port}`;
}

const auth = () => ({ Authorization: `Bearer ${jwt.sign({ role: 'admin' }, process.env.JWT_SECRET)}` });

test('non-numeric id returns 400 without touching the database', async t => {
    const url = await startServer(t);
    for (const method of ['GET', 'PUT', 'DELETE']) {
        const response = await fetch(`${url}/employees/abc`, {
            method,
            headers: { ...auth(), 'Content-Type': 'application/json' },
            body: method === 'PUT' ? '{}' : undefined
        });
        assert.equal(response.status, 400, method);
    }
});

test('create without body returns 400', async t => {
    const url = await startServer(t);
    const response = await fetch(`${url}/employees`, { method: 'POST', headers: auth() });
    assert.equal(response.status, 400);
});

test('malformed JSON returns 400', async t => {
    const url = await startServer(t);
    const response = await fetch(`${url}/employees`, {
        method: 'POST',
        headers: { ...auth(), 'Content-Type': 'application/json' },
        body: '{bad'
    });
    assert.equal(response.status, 400);
});
