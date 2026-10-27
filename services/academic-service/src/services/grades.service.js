// Regras de negócio para lançamento, alteração e remoção de notas.
const repository = require('../repositories/grades.repository');
const enrollments = require('../repositories/enrollments.repository');
const dependencies = require('../clients/dependencies.client');
const { publishEvent } = require('../messaging/publisher');
const { BadRequestError, NotFoundError, ConflictError } = require('../errors/AppError');

function positiveInteger(value) {
    return /^\d+$/.test(String(value))
        && Number(value) > 0
        && Number(value) <= 2147483647;
}

function validateGrade(input) {
    const candidateSubject = input.subject ?? input.assessment;
    const rawSubject = typeof candidateSubject === 'string' && !candidateSubject.trim()
        ? 'Avaliação'
        : candidateSubject ?? 'Avaliação';
    const subject = typeof rawSubject === 'string' ? rawSubject.trim() : '';
    const rawValue = input.value ?? input.score;
    const rawWeight = input.weight ?? 1;
    const value = Number(rawValue);
    const weight = Number(rawWeight);
    if (!subject || subject.length > 120) throw new BadRequestError('subject é obrigatório');
    if (rawValue === undefined || rawValue === null || rawValue === ''
        || !Number.isFinite(value) || value < 0 || value > 10) {
        throw new BadRequestError('score deve estar entre 0 e 10');
    }
    if (rawWeight === undefined || rawWeight === null || rawWeight === ''
        || !Number.isFinite(weight) || weight <= 0 || weight > 99999.999) {
        throw new BadRequestError('weight deve ser maior que zero');
    }
    return { subject, value, weight };
}

async function list(filters) {
    const normalized = {
        ...filters,
        enrollment_id: filters.enrollment_id ?? filters.enrollmentId,
        student_id: filters.student_id ?? filters.studentId,
        course_id: filters.course_id ?? filters.class_id ?? filters.classId
    };
    for (const field of ['enrollment_id', 'student_id', 'course_id']) {
        if (normalized[field] !== undefined && !positiveInteger(normalized[field])) {
            throw new BadRequestError(`${field} inválido`);
        }
    }
    return repository.list(normalized);
}

async function get(id) {
    if (!positiveInteger(id)) throw new BadRequestError('id de nota inválido');
    const grade = await repository.findById(id);
    if (!grade) throw new NotFoundError('nota não encontrada');
    return grade;
}

async function create(input, authorization) {
    const enrollmentId = input.enrollment_id ?? input.enrollmentId;
    let enrollment = null;
    if (enrollmentId !== undefined) {
        if (!positiveInteger(enrollmentId)) throw new BadRequestError('enrollmentId inválido');
        enrollment = await enrollments.findById(enrollmentId);
        if (!enrollment) throw new NotFoundError('inscrição não encontrada');
        if (enrollment.status !== 'active') {
            throw new ConflictError('não é possível lançar nota para uma inscrição inativa');
        }
    }
    const fields = validateGrade(input);
    const studentId = input.student_id ?? enrollment?.student_id;
    const requestedCourseId = input.course_id ?? input.class_id;
    const courseId = requestedCourseId ?? enrollment?.course_id ?? null;
    if (!positiveInteger(studentId)) throw new BadRequestError('student_id é obrigatório');
    if (requestedCourseId !== undefined && !positiveInteger(requestedCourseId)) {
        throw new BadRequestError('course_id inválido');
    }
    if (enrollment && String(studentId) !== String(enrollment.student_id)) {
        throw new ConflictError('student_id não corresponde à inscrição');
    }
    if (enrollment && courseId !== null && String(courseId) !== String(enrollment.course_id)) {
        throw new ConflictError('course_id não corresponde à inscrição');
    }
    await dependencies.getStudent(studentId, authorization);
    if (requestedCourseId !== undefined) {
        await dependencies.getCourse(courseId, authorization);
    }
    const grade = await repository.create({
        ...fields,
        enrollment_id: enrollment?.id ?? null,
        student_id: studentId,
        course_id: courseId
    });
    await publishEvent('grade.posted', {
        gradeId: grade.id,
        enrollmentId: grade.enrollment_id,
        studentId: grade.student_id,
        courseId: grade.course_id,
        subject: grade.subject,
        value: grade.value,
        score: grade.value,
        weight: grade.weight
    });
    return grade;
}

async function update(id, input) {
    if (!positiveInteger(id)) throw new BadRequestError('id de nota inválido');
    const current = await repository.findById(id);
    if (!current) throw new NotFoundError('nota não encontrada');
    const fields = validateGrade({
        ...input,
        subject: input.subject ?? input.assessment ?? current.subject,
        value: input.value ?? input.score ?? current.value,
        weight: input.weight ?? current.weight
    });
    const grade = await repository.update(id, fields);
    if (!grade) throw new NotFoundError('nota não encontrada');
    await publishEvent('grade.updated', {
        gradeId: grade.id,
        enrollmentId: grade.enrollment_id,
        studentId: grade.student_id,
        courseId: grade.course_id,
        previousSubject: current.subject,
        subject: grade.subject,
        value: grade.value,
        score: grade.value,
        weight: grade.weight
    });
    return grade;
}

async function remove(id) {
    if (!positiveInteger(id)) throw new BadRequestError('id de nota inválido');
    const grade = await repository.remove(id);
    if (!grade) throw new NotFoundError('nota não encontrada');
    await publishEvent('grade.deleted', {
        gradeId: grade.id,
        enrollmentId: grade.enrollment_id,
        studentId: grade.student_id,
        courseId: grade.course_id,
        subject: grade.subject
    });
    return grade;
}

module.exports = { list, get, create, update, remove };
