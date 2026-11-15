// Testes da outbox: gravação transacional e relay de eventos.
const assert = require('node:assert/strict');
const test = require('node:test');
const { pool } = require('../src/config/db');
const { publishEvent } = require('../src/messaging/publisher');
const { createRelay } = require('../src/messaging/relay');
const service = require('../src/services/students.service');

function relayClient(rows, overrides = {}) {
    const queries = [];
    const client = {
        queries,
        released: false,
        async query(sql, params) {
            queries.push([sql, params]);
            if (/^SELECT/.test(sql)) return { rows };
            return { rows: [], rowCount: rows.length };
        },
        release() { client.released = true; },
        ...overrides
    };
    return client;
}

const silence = async run => {
    const original = console.error;
    console.error = () => {};
    try { return await run(); } finally { console.error = original; }
};

const statements = client => client.queries.map(([sql]) => sql.split(' ')[0]);

test('publishEvent inserts envelope into outbox using given client', async () => {
    const calls = [];
    await publishEvent('some.event', { value: 1 }, { query: async (...args) => calls.push(args) });
    assert.equal(calls.length, 1);
    assert.match(calls[0][0], /INSERT INTO outbox_events/);
    const [eventId, type, envelope] = calls[0][1];
    const parsed = JSON.parse(envelope);
    assert.match(eventId, /^[0-9a-f-]{36}$/);
    assert.equal(type, 'some.event');
    assert.equal(parsed.id, eventId);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.type, 'some.event');
    assert.equal(parsed.source, 'student-service');
    assert.deepEqual(parsed.data, { value: 1 });
    assert.ok(Date.parse(parsed.occurredAt));
});

test('tick publishes in id order, deletes rows and commits', async () => {
    const rows = [
        { id: '1', type: 'a.one', envelope: { id: 'x' } },
        { id: '2', type: 'a.two', envelope: { id: 'y' } }
    ];
    const client = relayClient(rows);
    const published = [];
    const relay = createRelay({ pool: { connect: async () => client }, publish: async (...args) => published.push(args) });
    assert.equal(await relay.tick(), 2);
    assert.deepEqual(published, [['a.one', { id: 'x' }], ['a.two', { id: 'y' }]]);
    const remove = client.queries.find(([sql]) => /^DELETE/.test(sql));
    assert.deepEqual(remove[1], [['1', '2']]);
    assert.equal(statements(client).at(-1), 'COMMIT');
    assert.equal(client.released, true);
});

test('tick rolls back and keeps rows when publish fails', async () => {
    const client = relayClient([{ id: '1', type: 'a.one', envelope: {} }]);
    const relay = createRelay({
        pool: { connect: async () => client },
        publish: () => { throw new Error('RabbitMQ não está conectado'); }
    });
    assert.equal(await silence(() => relay.tick()), 0);
    assert.equal(statements(client).includes('DELETE'), false);
    assert.equal(statements(client).at(-1), 'ROLLBACK');
    assert.equal(client.released, true);
});

test('tick gives up on a publish that never confirms', async () => {
    const client = relayClient([{ id: '1', type: 'a.one', envelope: {} }]);
    const relay = createRelay({
        pool: { connect: async () => client },
        publish: () => new Promise(() => {}),
        publishTimeoutMs: 10
    });
    assert.equal(await silence(() => relay.tick()), 0);
    assert.equal(statements(client).at(-1), 'ROLLBACK');
});

test('tick survives an unavailable database', async () => {
    const relay = createRelay({
        pool: { connect: async () => { throw new Error('db down'); } },
        publish: async () => {}
    });
    assert.equal(await silence(() => relay.tick()), 0);
});

test('tick locks rows with SKIP LOCKED', async () => {
    const client = relayClient([]);
    const relay = createRelay({ pool: { connect: async () => client }, publish: async () => {} });
    await relay.tick();
    const select = client.queries.find(([sql]) => /^SELECT/.test(sql));
    assert.match(select[0], /ORDER BY id/);
    assert.match(select[0], /FOR UPDATE SKIP LOCKED/);
});

function transactionalPool(failOn) {
    const queries = [];
    const client = {
        async query(sql) {
            queries.push(sql);
            if (failOn.test(sql)) throw new Error('falha');
            return { rows: [{ id: 1 }], rowCount: 1 };
        },
        release() {}
    };
    return { queries, connect: async () => client };
}

test('createStudent does not commit when outbox insert fails', async () => {
    const fake = transactionalPool(/INSERT INTO outbox_events/);
    const original = pool.connect;
    pool.connect = fake.connect;
    try {
        await assert.rejects(service.createStudent({ registration: 'R1', name: 'Ana' }));
    } finally {
        pool.connect = original;
    }
    assert.equal(fake.queries[0], 'BEGIN');
    assert.ok(fake.queries.some(sql => /INSERT INTO students/.test(sql)));
    assert.equal(fake.queries.at(-1), 'ROLLBACK');
    assert.equal(fake.queries.includes('COMMIT'), false);
});

test('createStudent commits entity and outbox together', async () => {
    const fake = transactionalPool(/^$/);
    const original = pool.connect;
    pool.connect = fake.connect;
    try {
        await service.createStudent({ registration: 'R1', name: 'Ana' });
    } finally {
        pool.connect = original;
    }
    assert.ok(fake.queries.some(sql => /INSERT INTO outbox_events/.test(sql)));
    assert.equal(fake.queries.at(-1), 'COMMIT');
});
