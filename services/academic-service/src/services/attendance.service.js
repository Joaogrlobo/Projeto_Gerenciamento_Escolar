// Regras para frequência em lote, consultas, validação remota e resumos.
const repository = require('../repositories/attendance.repository');
const dependencies = require('../clients/dependencies.client');
const { publishEvent } = require('../messaging/publisher');
const { BadRequestError } = require('../errors/AppError');

const VALID_STATUSES = new Set(['present', 'absent', 'late', 'excused']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BULK_RECORDS = 500;

function validId(value) {
    return /^\d+$/.test(String(value))
        && Number(value) > 0
        && Number(value) <= 2147483647;
}

function validDate(value) {
    if (!DATE_PATTERN.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function list(filters) {
    const normalized = {
        ...filters,
        student_id: filters.student_id ?? filters.studentId,
        course_id: filters.course_id ?? filters.class_id ?? filters.classId,
        date: filters.date ?? filters.attendance_date
    };
    for (const field of ['student_id', 'course_id']) {
        if (normalized[field] !== undefined && !validId(normalized[field])) {
            throw new BadRequestError(`${field === 'course_id' ? 'class_id' : field} inválido`);
        }
    }
    for (const field of ['date', 'start_date', 'end_date']) {
        if (normalized[field] !== undefined && !validDate(normalized[field])) {
            throw new BadRequestError(`${field} inválida`);
        }
    }
    if (normalized.status !== undefined && !VALID_STATUSES.has(normalized.status)) {
        throw new BadRequestError('status de frequência inválido');
    }
    if (normalized.start_date && normalized.end_date && normalized.start_date > normalized.end_date) {
        throw new BadRequestError('start_date deve ser anterior ou igual a end_date');
    }
    return repository.list(normalized);
}

async function summarize(filters, authorization) {
    const normalized = {
        ...filters,
        student_id: filters.student_id ?? filters.studentId,
        course_id: filters.course_id ?? filters.class_id ?? filters.classId,
        ...(filters.date ? { start_date: filters.date, end_date: filters.date } : {})
    };
    for (const field of ['student_id', 'course_id']) {
        if (normalized[field] !== undefined && !validId(normalized[field])) {
            throw new BadRequestError(`${field === 'course_id' ? 'class_id' : field} inválido`);
        }
    }
    for (const field of ['start_date', 'end_date']) {
        if (normalized[field] !== undefined && !validDate(normalized[field])) {
            throw new BadRequestError(`${field} inválida`);
        }
    }
    if (normalized.start_date && normalized.end_date && normalized.start_date > normalized.end_date) {
        throw new BadRequestError('start_date deve ser anterior ou igual a end_date');
    }
    if (normalized.student_id === undefined && normalized.course_id === undefined) {
        throw new BadRequestError('informe student_id ou course_id');
    }
    if (normalized.student_id !== undefined) {
        await dependencies.getStudent(normalized.student_id, authorization);
    }
    if (normalized.course_id !== undefined) {
        await dependencies.getCourse(normalized.course_id, authorization);
    }
    return repository.summarize(normalized);
}

async function bulkUpsert(input, authorization) {
    const courseId = input.course_id ?? input.class_id ?? input.classId ?? null;
    const rawRecords = input.records ?? [{
        student_id: input.student_id ?? input.studentId,
        status: input.status,
        date: input.date ?? input.attendance_date
    }];
    if (!Array.isArray(rawRecords) || rawRecords.length === 0 || rawRecords.length > MAX_BULK_RECORDS) {
        throw new BadRequestError(`records deve conter de 1 a ${MAX_BULK_RECORDS} registros`);
    }
    if (rawRecords.some(record => !record || typeof record !== 'object' || Array.isArray(record))) {
        throw new BadRequestError('cada registro deve ser um objeto');
    }
    const records = rawRecords.map(record => ({
        ...record,
        student_id: record.student_id ?? record.studentId,
        date: record.date ?? record.attendance_date ?? input.date ?? input.attendance_date,
        status: record.status === 'justified' ? 'excused' : record.status
    }));
    if (courseId !== null && !validId(courseId)) throw new BadRequestError('class_id inválido');

    const studentIds = records.map(record => record.student_id);
    if (studentIds.some(id => !validId(id))) {
        throw new BadRequestError('todos os student_id devem ser positivos');
    }
    if (records.some(record => !VALID_STATUSES.has(record.status))) {
        throw new BadRequestError('status de frequência inválido');
    }
    const normalized = records.map(record => {
        const attendanceDate = record.date;
        if (!validDate(attendanceDate)) throw new BadRequestError('date inválida');
        return {
            student_id: record.student_id,
            course_id: courseId ?? 0,
            attendance_date: attendanceDate,
            status: record.status
        };
    });
    const keys = normalized.map(record =>
        `${record.student_id}:${record.course_id}:${record.attendance_date}`
    );
    if (new Set(keys).size !== keys.length) {
        throw new BadRequestError('há registros duplicados no lote');
    }

    if (courseId !== null) await dependencies.getCourse(courseId, authorization);
    await Promise.all([...new Set(studentIds.map(String))]
        .map(id => dependencies.getStudent(id, authorization)));
    const saved = await repository.upsertMany(normalized);

    await Promise.all(saved.map(record => publishEvent('attendance.recorded', {
        attendanceId: record.id,
        studentId: record.student_id,
        courseId: record.course_id,
        classId: record.course_id || null,
        attendanceDate: record.attendance_date,
        date: record.attendance_date,
        status: record.status,
        subject: input.subject
    })));
    return saved;
}

async function summarizeStudent(studentId, filters, authorization) {
    if (!validId(studentId)) throw new BadRequestError('student_id inválido');
    return {
        student_id: Number(studentId),
        ...(await summarize({ ...filters, student_id: studentId }, authorization))
    };
}

module.exports = { list, summarize, summarizeStudent, bulkUpsert };
