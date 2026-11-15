// Testes HTTP de validação: corpo ausente, tipos errados e JSON malformado devem gerar 400, não 500.
process.env.JWT_SECRET = 'user-service-test-secret';

const assert = require('node:assert/strict');
const test = require('node:test');
const app = require('../src/app');

async function startServer(t) {
    const server = app.listen(0);
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    return `http://127.0.0.1:${server.address().port}`;
}

test('register and login without body return 400', async t => {
    const url = await startServer(t);
    for (const path of ['/auth/register', '/auth/login']) {
        const response = await fetch(`${url}${path}`, { method: 'POST' });
        assert.equal(response.status, 400, path);
    }
});

test('register with non-string fields returns 400', async t => {
    const url = await startServer(t);
    const response = await fetch(`${url}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ana', email: 123, password: 123456 })
    });
    assert.equal(response.status, 400);
});

test('malformed JSON returns 400', async t => {
    const url = await startServer(t);
    const response = await fetch(`${url}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad'
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'JSON inválido' });
});
