process.env.JWT_SECRET = 'administrative-service-test-secret';
process.env.STAFF_SERVICE_URL = 'http://staff-service.test';

const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../src/app');
const { ensureTeacher } = require('../src/services/teachers.service');
const allocationsRepository = require('../src/repositories/allocations.repository');

test('health is public and protected routes enforce role permissions', async t => {
    const server = app.listen(0);
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    const url = `http://127.0.0.1:${server.address().port}`;

    const health = await fetch(`${url}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'administrative-service');

    const unauthenticated = await fetch(`${url}/classes`);
    assert.equal(unauthenticated.status, 401);

    const staffToken = jwt.sign({ role: 'staff' }, process.env.JWT_SECRET);
    const forbiddenWrite = await fetch(`${url}/classes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: '6A',
            school_year: 2026,
            shift: 'morning',
            capacity: 30
        })
    });
    assert.equal(forbiddenWrite.status, 403);
});

test('teacher lookup forwards authorization and maps non-teachers to 404', async t => {
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    let request;
    global.fetch = async (url, options) => {
        request = { url, options };
        return { ok: true, status: 200, json: async () => ({ id: 21, type: 'teacher' }) };
    };

    await ensureTeacher(21, 'Bearer signed-token');
    assert.equal(request.url, 'http://staff-service.test/employees/21');
    assert.equal(request.options.headers.Authorization, 'Bearer signed-token');
    assert.equal(request.options.signal.aborted, false);

    global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 21, type: 'admin_staff' })
    });
    await assert.rejects(ensureTeacher(21, 'Bearer signed-token'), error => error.statusCode === 404);
});

test('schedule conflicts join class rows and use strict overlap for the requested class year', async () => {
    let query;
    let values;
    await allocationsRepository.findScheduleConflict({
        teacher_id: 21,
        class_id: 3,
        room: 'Room A',
        weekday: 1,
        start_time: '10:00:00',
        end_time: '11:00:00'
    }, 'teacher', undefined, {
        query: async (sql, params) => {
            query = sql;
            values = params;
            return { rows: [] };
        }
    });
    assert.match(query, /JOIN classes allocation_class ON allocation_class\.id=a\.class_id/);
    assert.match(query, /JOIN classes requested_class ON requested_class\.id=\$2/);
    assert.match(query, /allocation_class\.school_year=requested_class\.school_year/);
    assert.match(query, /a\.weekday=\$3/);
    assert.match(query, /a\.start_time < \$4 AND a\.end_time > \$5/);
    assert.deepEqual(values, [21, 3, 1, '11:00:00', '10:00:00']);
});

test('schedule repository sorts by weekday then start time', async t => {
    const { pool } = require('../src/config/db');
    const originalQuery = pool.query;
    let query;
    pool.query = async sql => {
        query = sql;
        return { rows: [] };
    };
    t.after(() => { pool.query = originalQuery; });

    await allocationsRepository.teacherSchedule(21);
    assert.match(query, /ORDER BY a\.weekday, a\.start_time/);
});
