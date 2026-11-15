// Professor inativo não pode receber novas alocações, mas o horário dele continua consultável.
process.env.JWT_SECRET = 'administrative-service-test-secret';
process.env.STAFF_SERVICE_URL = 'http://staff-service.test';

const assert = require('node:assert/strict');
const test = require('node:test');
const { ensureTeacher } = require('../src/services/teachers.service');

test('inactive teacher is rejected only when requireActive is set', async t => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 21, type: 'teacher', active: false })
    });

    assert.equal((await ensureTeacher(21, 'Bearer x')).id, 21);
    await assert.rejects(
        ensureTeacher(21, 'Bearer x', { requireActive: true }),
        error => error.statusCode === 409
    );
});
