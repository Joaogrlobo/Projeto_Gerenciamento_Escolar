// Testes da outbox do serviço administrativo.
const assert = require('node:assert/strict');
const test = require('node:test');
const { pool } = require('../src/config/db');
const { publishEvent } = require('../src/messaging/publisher');
const { createRelay } = require('../src/messaging/relay');
const allocations = require('../src/services/allocations.service');
const classes = require('../src/services/classes.service');
const teachers = require('../src/services/teachers.service');

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
    assert.equal(parsed.source, 'administrative-service');
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


function fakePool({ failOn = /^$/ } = {}) {
    const queries = [];
    let connects = 0;
    const client = {
        async query(sql, params) {
            queries.push([sql, params]);
            if (failOn.test(sql)) throw new Error('falha');
            if (/^\s*SELECT/.test(sql)) return { rows: [], rowCount: 0 };
            return { rows: [{ id: 1, teacher_id: 2, class_id: 3, subject_id: 4 }], rowCount: 1 };
        },
        release() {}
    };
    return { queries, connect: async () => { connects += 1; return client; }, connects: () => connects };
}

async function usingPool(fake, run) {
    const original = pool.connect;
    pool.connect = fake.connect;
    try {
        return await run();
    } finally {
        pool.connect = original;
    }
}

const sqlOf = fake => fake.queries.map(([sql]) => sql);

test('createAllocation writes teacher.assigned and schedule.updated inside schedule lock', async t => {
    t.mock.method(teachers, 'ensureTeacher', async () => ({ id: 2 }));
    t.mock.method(pool, 'query', async () => ({ rows: [{ id: 3 }], rowCount: 1 }));
    const fake = fakePool();
    await usingPool(fake, () => allocations.createAllocation({
        class_id: 3, subject_id: 4, teacher_id: 2, weekday: 1, start_time: '07:00', end_time: '08:00'
    }, 'Bearer x'));
    assert.equal(fake.connects(), 1);
    const types = fake.queries.filter(([sql]) => /INSERT INTO outbox_events/.test(sql)).map(([, params]) => params[1]);
    assert.deepEqual(types, ['teacher.assigned', 'schedule.updated']);
    assert.equal(sqlOf(fake).at(-1), 'COMMIT');
});

test('class is not committed when outbox insert fails', async () => {
    const fake = fakePool({ failOn: /INSERT INTO outbox_events/ });
    await usingPool(fake, () => assert.rejects(classes.createClass({
        name: '6A', school_year: 2026, shift: 'morning', capacity: 30
    })));
    assert.equal(sqlOf(fake)[0], 'BEGIN');
    assert.ok(sqlOf(fake).some(sql => /INSERT INTO classes/.test(sql)));
    assert.equal(sqlOf(fake).at(-1), 'ROLLBACK');
});
