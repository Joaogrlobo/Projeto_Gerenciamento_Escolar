// Testes de regras de notas que não dependem de banco real.
const assert = require('node:assert/strict');
const test = require('node:test');
const { pool } = require('../src/config/db');
const repository = require('../src/repositories/grades.repository');
const grades = require('../src/services/grades.service');

function fakeClient() {
    return { async query() { return { rows: [], rowCount: 0 }; }, release() {} };
}

test('editing a grade with an empty assessment keeps the stored subject', async t => {
    t.mock.method(pool, 'connect', async () => fakeClient());
    t.mock.method(repository, 'findById', async () => ({
        id: 7, subject: 'Matemática', value: 6, weight: 2
    }));
    const update = t.mock.method(repository, 'update', async (id, fields) => ({ id, ...fields }));

    await grades.update(7, { assessment: '', value: 9 });

    const [, fields] = update.mock.calls[0].arguments;
    assert.deepEqual(fields, { subject: 'Matemática', value: 9, weight: 2 });
});
