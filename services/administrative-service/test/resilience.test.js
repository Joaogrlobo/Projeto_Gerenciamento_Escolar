// Testes de retry e Circuit Breaker na consulta de professores.
process.env.STAFF_SERVICE_URL = 'http://staff.test';
process.env.JWT_SECRET = 'test';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createResilientCall, circuitStates } = require('../src/resilience/resilient-call');
const { NotFoundError, ServiceUnavailableError } = require('../src/errors/AppError');
const { ensureTeacher } = require('../src/services/teachers.service');
const app = require('../src/app');

const options = extra => ({
    backoffMs: [1, 1],
    onUnavailable: () => new ServiceUnavailableError('indisponível'),
    ...extra
});

function failing(error) {
    const fn = async () => { fn.calls += 1; throw error; };
    fn.calls = 0;
    return fn;
}

test('retries 503 and succeeds on third attempt', async () => {
    const call = createResilientCall('t1', options());
    let calls = 0;
    const result = await call(async () => {
        calls += 1;
        if (calls < 3) throw new ServiceUnavailableError('indisponível');
        return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 3);
});

test('gives up after configured attempts', async () => {
    const call = createResilientCall('t2', options());
    const fn = failing(new ServiceUnavailableError('indisponível'));
    await assert.rejects(call(fn), { statusCode: 503 });
    assert.equal(fn.calls, 3);
});

test('does not retry 404', async () => {
    const call = createResilientCall('t3', options());
    const fn = failing(new NotFoundError('aluno não encontrado'));
    await assert.rejects(call(fn), NotFoundError);
    assert.equal(fn.calls, 1);
});

test('4xx never opens the circuit', async () => {
    const call = createResilientCall('t4', options());
    const fn = failing(new NotFoundError('aluno não encontrado'));
    for (let i = 0; i < 10; i += 1) await assert.rejects(call(fn));
    assert.equal(call.state(), 'CLOSED');
    assert.equal(fn.calls, 10);
});

test('opens after 5 failures and stops calling', async () => {
    const call = createResilientCall('t5', options({ attempts: 1 }));
    const fn = failing(new ServiceUnavailableError('indisponível'));
    for (let i = 0; i < 5; i += 1) await assert.rejects(call(fn));
    assert.equal(call.state(), 'OPEN');
    await assert.rejects(call(fn), { statusCode: 503 });
    assert.equal(fn.calls, 5);
});

test('half-open closes after a success', async () => {
    const call = createResilientCall('t6', options({ attempts: 1, resetTimeoutMs: 50 }));
    const fn = failing(new ServiceUnavailableError('indisponível'));
    for (let i = 0; i < 5; i += 1) await assert.rejects(call(fn));
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(call.state(), 'HALF_OPEN');
    assert.equal(await call(async () => 'ok'), 'ok');
    assert.equal(call.state(), 'CLOSED');
});

test('circuitStates lists circuits by name', () => {
    createResilientCall('t7', options());
    assert.equal(circuitStates().t7, 'CLOSED');
});

test('slow failures spread over 12 s still open the circuit', async t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const call = createResilientCall('slow', options({ attempts: 1 }));
    const fn = failing(new ServiceUnavailableError('indisponível'));
    for (let i = 0; i < 5; i += 1) {
        await assert.rejects(call(fn));
        t.mock.timers.tick(3000);
    }
    assert.equal(call.state(), 'OPEN');
});

function json(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('each attempt is limited to 1200 ms', async t => {
    const timeout = t.mock.method(AbortSignal, 'timeout');
    t.mock.method(globalThis, 'fetch', async () => json(200, { id: 1, type: 'teacher' }));
    await ensureTeacher(1, 'Bearer x');
    assert.deepEqual(timeout.mock.calls[0].arguments, [1200]);
});

test('authorization failure from staff is neither retried nor reported as outage', async t => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => json(403, {}));
    await assert.rejects(ensureTeacher(1, 'Bearer x'), { statusCode: 403 });
    assert.equal(fetchMock.mock.callCount(), 1);
});

test('health reports circuit states', async t => {
    const server = app.listen(0);
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    const health = await (await fetch(`http://127.0.0.1:${server.address().port}/health`)).json();
    assert.equal(health.circuits['staff-service'], 'CLOSED');
});

test('staff circuit opens after repeated outages', async t => {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => json(503, {}));
    for (let i = 0; i < 5; i += 1) await assert.rejects(ensureTeacher(1, 'Bearer x'), { statusCode: 503 });
    const before = fetchMock.mock.callCount();
    await assert.rejects(ensureTeacher(1, 'Bearer x'), { statusCode: 503 });
    assert.equal(fetchMock.mock.callCount(), before);
});
