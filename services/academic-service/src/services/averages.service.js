// Processamento idempotente de eventos de nota e persistência da média ponderada.
const { pool } = require('../config/db');
const gradesRepository = require('../repositories/grades.repository');
const dependencies = require('../clients/dependencies.client');
const { BadRequestError } = require('../errors/AppError');

async function getAverage(studentId, subject, authorization) {
    if (!/^\d+$/.test(String(studentId)) || Number(studentId) < 1 || Number(studentId) > 2147483647) {
        throw new BadRequestError('student_id inválido');
    }
    if (subject !== undefined && (typeof subject !== 'string' || !subject.trim() || subject.length > 120)) {
        throw new BadRequestError('subject inválido');
    }
    await dependencies.getStudent(studentId, authorization);
    const average = await gradesRepository.findAverage(studentId, subject) || {
        student_id: Number(studentId),
        subject,
        average: '0.00',
        total_weight: '0.000',
        grade_count: 0,
        updated_at: null
    };
    return {
        ...average,
        average: Number(average.average),
        total_weight: Number(average.total_weight),
        grade_count: Number(average.grade_count)
    };
}

async function processGradeEvent(event) {
    if (!event || !event.id || !['grade.created', 'grade.posted', 'grade.updated', 'grade.deleted'].includes(event.type)) {
        throw new Error('Evento de nota inválido');
    }
    const data = event.data || {};
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const inserted = await client.query(
            'INSERT INTO academic_processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id',
            [String(event.id)]
        );
        if (!inserted.rowCount) {
            await client.query('COMMIT');
            return null;
        }

        const grade = data.gradeId
            ? await gradesRepository.findById(data.gradeId, client)
            : null;
        const studentId = grade ? grade.student_id : data.studentId;
        const subject = grade ? grade.subject : data.subject;
        if (!studentId || !subject) throw new Error('Evento de nota sem aluno ou disciplina');
        const subjects = new Set([subject]);
        if (data.previousSubject) subjects.add(data.previousSubject);
        const results = [];
        for (const currentSubject of subjects) {
            await client.query(
                'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
                [String(studentId), String(currentSubject)]
            );
            const aggregate = await gradesRepository.calculateAverage(studentId, currentSubject, client);
            results.push(await gradesRepository.upsertAverage(studentId, currentSubject, aggregate, client));
        }
        await client.query('COMMIT');
        const average = results.find(item => item.subject === subject);
        return {
            studentId: average.student_id,
            subject: average.subject,
            average: Number(average.average),
            totalWeight: Number(average.total_weight),
            gradeCount: Number(average.grade_count),
            sourceEventId: String(event.id)
        };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { getAverage, processGradeEvent };
