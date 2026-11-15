// Testes da outbox do serviço acadêmico.
const assert = require('node:assert/strict');
const test = require('node:test');
const { pool } = require('../src/config/db');
const { publishEvent } = require('../src/messaging/publisher');
const { createRelay } = require('../src/messaging/relay');
const { handleGradeMessage } = require('../src/messaging/consumer');
const { processGradeEvent } = require('../src/services/averages.service');
const grades = require('../src/services/grades.service');
const attendance = require('../src/services/attendance.service');
const dependencies = require('../src/clients/dependencies.client');

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
    assert.equal(parsed.source, 'academic-service');
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


const row = { id: 1, student_id: 1, course_id: 0, subject: 'Mat', value: '8', weight: '1', enrollment_id: null,
    average: '8.00', total_weight: '1', grade_count: 1, attendance_date: '2026-01-01', status: 'present' };

function fakePool({ failOn = /^$/, rowCount = 1 } = {}) {
    const queries = [];
    let connects = 0;
    const client = {
        async query(sql, params) {
            queries.push([sql, params]);
            if (failOn.test(sql)) throw new Error('falha');
            return { rows: rowCount ? [row] : [], rowCount };
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
const indexOf = (fake, pattern) => sqlOf(fake).findIndex(sql => pattern.test(sql));

test('processGradeEvent writes average.calculated in the same transaction', async () => {
    const fake = fakePool();
    await usingPool(fake, () => processGradeEvent({
        id: 'e1', type: 'grade.posted', data: { studentId: 1, subject: 'Mat' }
    }));
    const outbox = indexOf(fake, /INSERT INTO outbox_events/);
    assert.ok(outbox > 0);
    assert.ok(outbox < indexOf(fake, /^COMMIT$/));
    assert.equal(fake.queries[outbox][1][1], 'average.calculated');
    assert.equal(JSON.parse(fake.queries[outbox][1][2]).data.sourceEventId, 'e1');
});

test('duplicate grade event writes no average event', async () => {
    const fake = fakePool({ rowCount: 0 });
    await usingPool(fake, () => processGradeEvent({
        id: 'e1', type: 'grade.posted', data: { studentId: 1, subject: 'Mat' }
    }));
    assert.equal(indexOf(fake, /INSERT INTO outbox_events/), -1);
});

test('handleGradeMessage acks without publishing directly', async () => {
    const original = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    let acks = 0;
    try {
        await handleGradeMessage(
            { ack: () => { acks += 1; } },
            { content: Buffer.from('{"id":"a"}') },
            async () => ({ studentId: 1 })
        );
    } finally {
        console.error = original;
    }
    assert.equal(acks, 1);
    assert.deepEqual(errors, []);
});

function stubDependencies(t) {
    t.mock.method(dependencies, 'getStudent', async () => ({ id: 1 }));
    t.mock.method(dependencies, 'getCourse', async () => ({ id: 1 }));
}

test('grade is not committed when outbox insert fails', async t => {
    stubDependencies(t);
    const fake = fakePool({ failOn: /INSERT INTO outbox_events/ });
    await usingPool(fake, () => assert.rejects(
        grades.create({ student_id: 1, subject: 'Mat', value: 8 }, 'Bearer x')
    ));
    assert.equal(sqlOf(fake)[0], 'BEGIN');
    assert.ok(indexOf(fake, /INSERT INTO academic_grades/) > 0);
    assert.equal(sqlOf(fake).at(-1), 'ROLLBACK');
});

test('attendance batch and its events share one transaction', async t => {
    stubDependencies(t);
    const fake = fakePool();
    await usingPool(fake, () => attendance.bulkUpsert({
        records: [{ student_id: 1, date: '2026-01-01', status: 'present' }]
    }, 'Bearer x'));
    assert.equal(fake.connects(), 1);
    const outbox = indexOf(fake, /INSERT INTO outbox_events/);
    assert.ok(indexOf(fake, /INSERT INTO academic_attendance/) < outbox);
    assert.ok(outbox < indexOf(fake, /^COMMIT$/));
});
