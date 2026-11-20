// Testes do seed de usuários: leitura do CSV e criação idempotente.
const assert = require('node:assert/strict');
const test = require('node:test');
const { parseCsv, seedUsers } = require('./seed-users');

const csv = 'name,email,role,password\r\n'
    + 'Administrador,Admin@Escola.com,admin,Senha@1\r\n'
    + 'Professor 001,teacher.001@escola.com,teacher,Teacher@001!\r\n'
    + '\r\n'
    + 'Aluno 001,student.001@escola.com,student,Student@001!\r\n';

test('parseCsv maps columns by header and ignores blank lines', () => {
    assert.deepEqual(parseCsv(csv), [
        { name: 'Administrador', email: 'Admin@Escola.com', role: 'admin', password: 'Senha@1' },
        { name: 'Professor 001', email: 'teacher.001@escola.com', role: 'teacher', password: 'Teacher@001!' },
        { name: 'Aluno 001', email: 'student.001@escola.com', role: 'student', password: 'Student@001!' }
    ]);
});

test('parseCsv rejects a file without the required columns', () => {
    assert.throws(() => parseCsv('nome,email\nAna,a@b.c\n'), /colunas obrigatórias/);
});

function fakeApi(existingEmails = []) {
    const calls = [];
    const api = async (method, route, body) => {
        calls.push([method, route, body]);
        if (existingEmails.includes(body.email)) {
            return { status: 409 };
        }
        return { status: 201 };
    };
    return { api, calls };
}

test('creates every user through POST /api/users', async () => {
    const { api, calls } = fakeApi();
    const summary = await seedUsers(parseCsv(csv), api, 'outro@escola.com');
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[1], ['POST', '/api/users', {
        name: 'Professor 001', email: 'teacher.001@escola.com', role: 'teacher', password: 'Teacher@001!'
    }]);
    assert.deepEqual(summary, { created: 3, existing: 0, skipped: 0, failed: [] });
});

test('skips the admin already created from ADMIN_EMAIL, ignoring case', async () => {
    const { api, calls } = fakeApi();
    const summary = await seedUsers(parseCsv(csv), api, 'admin@escola.com');
    assert.equal(calls.some(([, , body]) => body.email === 'Admin@Escola.com'), false);
    assert.equal(summary.skipped, 1);
});

test('counts users that already exist instead of failing', async () => {
    const { api } = fakeApi(['teacher.001@escola.com']);
    const summary = await seedUsers(parseCsv(csv), api, 'outro@escola.com');
    assert.deepEqual(summary, { created: 2, existing: 1, skipped: 0, failed: [] });
});

test('reports rejected rows and keeps going', async () => {
    const api = async (method, route, body) => (
        body.role === 'teacher' ? { status: 400, error: 'senha deve ter ao menos 6 caracteres' } : { status: 201 }
    );
    const summary = await seedUsers(parseCsv(csv), api, 'outro@escola.com');
    assert.equal(summary.created, 2);
    assert.deepEqual(summary.failed, [{ email: 'teacher.001@escola.com', reason: 'HTTP 400: senha deve ter ao menos 6 caracteres' }]);
});
