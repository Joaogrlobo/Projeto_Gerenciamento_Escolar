#!/usr/bin/env node
// Popula o ambiente local com dados de demonstração usando apenas a API pública (gateway).
// Uso: node scripts/seed-demo.js [--base-url http://localhost:8080]
// Lê ADMIN_EMAIL/ADMIN_PASSWORD do ambiente ou do .env da raiz. Requer Node 18+.
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const baseUrlArg = args.indexOf('--base-url');
const BASE_URL = (baseUrlArg >= 0 ? args[baseUrlArg + 1] : process.env.BASE_URL) || 'http://localhost:8080';
const YEAR = 2026;
const DEMO_PASSWORD = 'Demo@123';

function loadEnv() {
    const file = path.join(__dirname, '..', '.env');
    const env = {};
    if (fs.existsSync(file)) {
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
        }
    }
    return {
        email: process.env.ADMIN_EMAIL || env.ADMIN_EMAIL || 'admin@distrischool.com',
        password: process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD || 'admin123'
    };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let token = null;

async function api(method, route, body, { expect = [200, 201, 202, 204] } = {}) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await fetch(`${BASE_URL}${route}`, {
            method,
            headers: {
                'content-type': 'application/json',
                ...(token ? { authorization: `Bearer ${token}` } : {})
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (response.status === 429 || response.status === 503) {
            const wait = Number(response.headers.get('retry-after') || response.headers.get('ratelimit-reset') || 5);
            console.log(`  aguardando ${wait}s (HTTP ${response.status})...`);
            await sleep(wait * 1000);
            continue;
        }
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = text; }
        if (!expect.includes(response.status)) {
            const detail = typeof data === 'object' && data ? (data.error || data.message || JSON.stringify(data)) : text;
            throw new Error(`${method} ${route} -> HTTP ${response.status}: ${detail}`);
        }
        return data;
    }
    throw new Error(`${method} ${route}: limite de tentativas atingido`);
}

const idOf = (data) => data?.id ?? data?.data?.id;
const listOf = (data) => (Array.isArray(data) ? data : data?.data ?? data?.items ?? []);

// ---------------------------------------------------------------- dados

const loginUsers = [
    { name: 'Ana Souza (Professora)', email: 'prof.ana@distrischool.com', role: 'teacher' },
    { name: 'Juliana Pereira (Secretaria)', email: 'secretaria@distrischool.com', role: 'staff' },
    { name: 'Lucas Oliveira (Aluno)', email: 'aluno.lucas@distrischool.com', role: 'student' }
];

const teachers = [
    { key: 'mat', name: 'Ana Souza', email: 'ana.souza@distrischool.com', phone: '(11) 98811-1001', qualification: 'Licenciatura em Matemática', subjects: 'Matemática' },
    { key: 'por', name: 'Carlos Lima', email: 'carlos.lima@distrischool.com', phone: '(11) 98811-1002', qualification: 'Letras - Português', subjects: 'Língua Portuguesa' },
    { key: 'cie', name: 'Beatriz Rocha', email: 'beatriz.rocha@distrischool.com', phone: '(11) 98811-1003', qualification: 'Ciências Biológicas', subjects: 'Ciências' },
    { key: 'his', name: 'Diego Martins', email: 'diego.martins@distrischool.com', phone: '(11) 98811-1004', qualification: 'Licenciatura em História', subjects: 'História' },
    { key: 'ing', name: 'Fernanda Alves', email: 'fernanda.alves@distrischool.com', phone: '(11) 98811-1005', qualification: 'Letras - Inglês', subjects: 'Inglês' }
];

const adminStaff = [
    { name: 'Juliana Pereira', email: 'juliana.pereira@distrischool.com', phone: '(11) 98811-2001', qualification: 'Administração', position: 'Secretária Escolar' },
    { name: 'Roberto Nunes', email: 'roberto.nunes@distrischool.com', phone: '(11) 98811-2002', qualification: 'Pedagogia', position: 'Coordenador Pedagógico' }
];

const subjects = [
    { key: 'mat', name: 'Matemática', workload_hours: 80 },
    { key: 'por', name: 'Língua Portuguesa', workload_hours: 80 },
    { key: 'cie', name: 'Ciências', workload_hours: 60 },
    { key: 'his', name: 'História', workload_hours: 60 },
    { key: 'ing', name: 'Inglês', workload_hours: 40 }
];

// Turmas da manhã usam faixas de horário diferentes para não haver conflito de professor.
const classes = [
    { key: '6A', name: '6º Ano A', shift: 'morning', capacity: 30, room: 'Sala 101', start: '07:30', end: '09:10' },
    { key: '8A', name: '8º Ano A', shift: 'morning', capacity: 25, room: 'Sala 103', start: '09:30', end: '11:10' },
    { key: '7B', name: '7º Ano B', shift: 'afternoon', capacity: 30, room: 'Sala 102', start: '13:30', end: '15:10' }
];

const students = [
    ['Lucas Oliveira', '2014-03-12', '6A'], ['Mariana Costa', '2014-07-25', '6A'],
    ['Pedro Henrique Silva', '2014-01-08', '6A'], ['Sofia Ribeiro', '2014-10-30', '6A'],
    ['Gabriel Santos', '2013-05-17', '7B'], ['Isabela Ferreira', '2013-09-02', '7B'],
    ['Rafael Almeida', '2013-02-21', '7B'], ['Laura Carvalho', '2013-12-11', '7B'],
    ['Matheus Gomes', '2012-04-05', '8A'], ['Beatriz Moreira', '2012-08-19', '8A'],
    ['Enzo Barbosa', '2012-06-27', '8A'], ['Valentina Araújo', '2012-11-14', '8A']
].map(([name, birth_date, classKey], index) => ({
    registration: `DS${YEAR}${String(index + 1).padStart(3, '0')}`,
    name,
    birth_date,
    classKey,
    contact: `(11) 97700-${String(3001 + index)}`,
    address: `Rua das Escolas, ${100 + index * 10} - São Paulo/SP`
}));

// Notas determinísticas (prova peso 2 + trabalho peso 1) por aluno/disciplina.
function score(studentIndex, subjectIndex, assessment) {
    const raw = 5 + ((studentIndex * 7 + subjectIndex * 3 + assessment * 5) % 50) / 10;
    return Math.min(10, Math.round(raw * 2) / 2);
}

function lastWeekDates() {
    const today = new Date();
    const monday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
    const weekday = monday.getUTCDay() || 7;
    monday.setUTCDate(monday.getUTCDate() - weekday + 1 - 7);
    return [0, 1, 2, 3, 4].map((offset) => {
        const date = new Date(monday);
        date.setUTCDate(monday.getUTCDate() + offset);
        return date.toISOString().slice(0, 10);
    });
}

// ---------------------------------------------------------------- execução

async function main() {
    const admin = loadEnv();
    console.log(`Seed de demonstração em ${BASE_URL}`);

    const health = await fetch(`${BASE_URL}/health`).catch(() => null);
    if (!health || !health.ok) throw new Error('gateway indisponível; suba o ambiente com docker compose up -d');

    const login = await api('POST', '/api/auth/login', { email: admin.email, password: admin.password });
    token = login.token;

    const existing = listOf(await api('GET', `/api/students?q=DS${YEAR}001`));
    if (existing.length > 0) {
        console.log('Dados de demonstração já existem (aluno DS2026001 encontrado). Nada a fazer.');
        return;
    }

    console.log('1/8 Usuários de login');
    for (const user of loginUsers) {
        await api('POST', '/api/users', { ...user, password: DEMO_PASSWORD }, { expect: [201, 409] });
    }

    console.log('2/8 Professores e técnicos administrativos');
    const teacherIds = {};
    for (const teacher of teachers) {
        const { key, ...body } = teacher;
        teacherIds[key] = idOf(await api('POST', '/api/employees', { type: 'teacher', position: 'Professor(a)', ...body }));
    }
    for (const staff of adminStaff) {
        await api('POST', '/api/employees', { type: 'admin_staff', subjects: '', ...staff });
    }

    console.log('3/8 Disciplinas');
    const subjectIds = {};
    for (const subject of subjects) {
        subjectIds[subject.key] = idOf(await api('POST', '/api/administrative/subjects', { name: subject.name, workload_hours: subject.workload_hours }));
    }

    console.log('4/8 Turmas');
    const classIds = {};
    for (const item of classes) {
        classIds[item.key] = idOf(await api('POST', '/api/administrative/classes', {
            name: item.name, school_year: YEAR, shift: item.shift, capacity: item.capacity, active: true
        }));
    }

    console.log('5/8 Grade horária (alocação de professores)');
    for (const item of classes) {
        for (const [index, subject] of subjects.entries()) {
            await api('POST', '/api/administrative/allocations', {
                class_id: classIds[item.key],
                subject_id: subjectIds[subject.key],
                teacher_id: teacherIds[subject.key],
                room: item.room,
                weekday: index + 1,
                start_time: item.start,
                end_time: item.end
            });
        }
    }

    console.log('6/8 Alunos e matrículas');
    const enrolled = [];
    for (const student of students) {
        const { classKey, ...body } = student;
        const className = classes.find((item) => item.key === classKey).name;
        const studentId = idOf(await api('POST', '/api/students', { ...body, class_name: className }));
        const enrollment = await api('POST', '/api/academic/enrollments', {
            student_id: studentId, course_id: classIds[classKey], academic_year: String(YEAR), status: 'active'
        });
        enrolled.push({ studentId, enrollmentId: idOf(enrollment), classId: classIds[classKey], classKey });
    }

    console.log('7/8 Notas (média ponderada calculada de forma assíncrona via RabbitMQ)');
    const gradedSubjects = subjects.slice(0, 3);
    for (const [studentIndex, item] of enrolled.entries()) {
        for (const [subjectIndex, subject] of gradedSubjects.entries()) {
            for (const [assessment, weight] of [[0, 2], [1, 1]]) {
                await api('POST', '/api/academic/grades', {
                    enrollment_id: item.enrollmentId,
                    student_id: item.studentId,
                    course_id: item.classId,
                    subject: subject.name,
                    score: score(studentIndex, subjectIndex, assessment),
                    weight
                });
            }
        }
    }

    console.log('8/8 Frequência da semana passada');
    const dates = lastWeekDates();
    for (const item of classes) {
        const classStudents = enrolled.filter((entry) => entry.classKey === item.key);
        const records = [];
        for (const [dayIndex, date] of dates.entries()) {
            for (const [position, entry] of classStudents.entries()) {
                let status = 'present';
                if (position === 1 && dayIndex === 2) status = 'absent';
                if (position === 2 && dayIndex === 4) status = 'late';
                if (position === 3 && (dayIndex === 0 || dayIndex === 3)) status = 'absent';
                records.push({ student_id: entry.studentId, date, status });
            }
        }
        await api('POST', '/api/academic/attendance', { course_id: classIds[item.key], records });
    }

    console.log('\nSeed concluído:');
    console.log(`  ${teachers.length} professores, ${adminStaff.length} técnicos, ${subjects.length} disciplinas, ${classes.length} turmas`);
    console.log(`  ${classes.length * subjects.length} alocações, ${students.length} alunos/matrículas, ${enrolled.length * gradedSubjects.length * 2} notas, frequência de ${dates[0]} a ${dates[4]}`);
    console.log(`  Logins extras (senha ${DEMO_PASSWORD}): ${loginUsers.map((user) => `${user.email} [${user.role}]`).join(', ')}`);
}

main().catch((error) => {
    console.error(`\nFalha no seed: ${error.message}`);
    process.exit(1);
});
