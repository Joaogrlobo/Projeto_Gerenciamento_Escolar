// Testes de público por perfil, mensagens e contador de não lidas.
process.env.JWT_SECRET = 'notification-test-secret';

const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const { pool } = require('../src/config/db');
const repository = require('../src/repositories/notifications.repository');
const service = require('../src/services/notifications.service');
const { rolesFor } = require('../src/services/audience');
const app = require('../src/app');

const STAFF = ['admin', 'staff'];
const CLASSROOM = ['admin', 'staff', 'teacher'];

test('rolesFor maps each event family', () => {
    assert.deepEqual(rolesFor('user.logged'), []);
    assert.deepEqual(rolesFor('user.registered'), ['admin']);
    assert.deepEqual(rolesFor('something.unknown'), ['admin']);
    for (const type of ['student.created', 'employee.deleted', 'enrollment.status_changed', 'class.created']) {
        assert.deepEqual(rolesFor(type), STAFF, type);
    }
    for (const type of ['grade.posted', 'average.calculated', 'attendance.recorded', 'teacher.assigned', 'schedule.updated']) {
        assert.deepEqual(rolesFor(type), CLASSROOM, type);
    }
});

test('formatMessage covers new event types', () => {
    const cases = {
        'student.updated': /Aluno atualizado/,
        'student.deleted': /Aluno removido/,
        'employee.created': /Funcionário cadastrado/,
        'employee.updated': /Funcionário atualizado/,
        'employee.deleted': /Funcionário removido/,
        'user.registered': /Novo usuário/,
        'grade.updated': /Nota alterada/,
        'grade.deleted': /Nota removida/,
        'average.calculated': /Média atualizada/,
        'enrollment.status_changed': /Matrícula/,
        'class.created': /Turma criada/,
        'schedule.updated': /Horários atualizados/
    };
    for (const [type, pattern] of Object.entries(cases)) {
        assert.match(service.formatMessage(type, { studentId: 1, employeeId: 2, subject: 'Mat', average: 8 }), pattern);
    }
});

test('user.logged is stored with empty audience', async t => {
    const insert = t.mock.method(repository, 'insert', async () => null);
    await service.recordEvent({ id: 'e1', type: 'user.logged', data: {} });
    assert.deepEqual(insert.mock.calls[0].arguments[0].audience, []);
});

test('list filters by role', async t => {
    const query = t.mock.method(pool, 'query', async () => ({ rows: [] }));
    await repository.list(null, 10, 'teacher');
    const [sql, params] = query.mock.calls[0].arguments;
    assert.match(sql, /= ANY\(audience\)/);
    assert.deepEqual(params, ['teacher', 10]);
});

test('unread count uses user cursor', async t => {
    const query = t.mock.method(pool, 'query', async () => ({ rows: [{ count: 3 }] }));
    assert.equal(await repository.countUnread('teacher', 7), 3);
    const [sql, params] = query.mock.calls[0].arguments;
    assert.match(sql, /notification_cursors/);
    assert.match(sql, /COALESCE/);
    assert.deepEqual(params, ['teacher', 7]);
});

async function withServer(t) {
    const server = app.listen(0);
    t.after(() => new Promise(resolve => server.close(resolve)));
    await new Promise(resolve => server.once('listening', resolve));
    return `http://127.0.0.1:${server.address().port}/notifications`;
}

const bearer = (role, sub = 7) => ({
    Authorization: `Bearer ${jwt.sign({ role, sub }, process.env.JWT_SECRET)}`
});

test('student role receives 403', async t => {
    const url = await withServer(t);
    assert.equal((await fetch(url, { headers: bearer('student') })).status, 403);
    assert.equal((await fetch(`${url}/unread-count`, { headers: bearer('parent') })).status, 403);
});

test('teacher lists notifications for own role', async t => {
    const list = t.mock.method(repository, 'list', async () => [{ event_id: 'a' }]);
    const url = await withServer(t);
    const response = await fetch(url, { headers: bearer('teacher') });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{ event_id: 'a' }]);
    assert.equal(list.mock.calls[0].arguments[2], 'teacher');
});

test('unread-count returns count for user', async t => {
    const count = t.mock.method(repository, 'countUnread', async () => 4);
    const url = await withServer(t);
    const response = await fetch(`${url}/unread-count`, { headers: bearer('staff') });
    assert.deepEqual(await response.json(), { count: 4 });
    assert.deepEqual(count.mock.calls[0].arguments, ['staff', 7]);
});

test('seen stores cursor for user', async t => {
    const seen = t.mock.method(repository, 'markSeen', async () => {});
    const url = await withServer(t);
    const response = await fetch(`${url}/seen`, { method: 'POST', headers: bearer('admin', 9) });
    assert.equal(response.status, 204);
    assert.deepEqual(seen.mock.calls[0].arguments, [9]);
});
