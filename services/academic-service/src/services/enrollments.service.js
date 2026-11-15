// Regras de inscrição, validação remota de entidades e limite de vagas.
const repository = require('../repositories/enrollments.repository');
const dependencies = require('../clients/dependencies.client');
const { publishEvent } = require('../messaging/publisher');
const {
    BadRequestError,
    ConflictError,
    NotFoundError
} = require('../errors/AppError');

const VALID_STATUSES = new Set(['pending', 'active', 'cancelled', 'completed']);

function isPositiveId(value) {
    return /^\d+$/.test(String(value))
        && Number(value) > 0
        && Number(value) <= 2147483647;
}

function courseLimit(course) {
    const value = course.max_students
        ?? course.maxStudents
        ?? course.capacity
        ?? course.max_enrollments
        ?? course.enrollment_limit
        ?? course.enrollmentLimit
        ?? course.student_limit;
    if (value === undefined || value === null || value === '') return null;
    const limit = Number(value);
    return Number.isInteger(limit) && limit >= 0 ? limit : null;
}

async function list(filters) {
    const normalized = {
        ...filters,
        student_id: filters.student_id ?? filters.studentId,
        course_id: filters.course_id ?? filters.class_id ?? filters.classId,
        academic_year: filters.academic_year ?? filters.academicYear
    };
    for (const field of ['student_id', 'course_id']) {
        if (normalized[field] !== undefined && !isPositiveId(normalized[field])) {
            throw new BadRequestError(`${field === 'course_id' ? 'class_id' : field} inválido`);
        }
    }
    if (normalized.status !== undefined && !VALID_STATUSES.has(normalized.status)) {
        throw new BadRequestError('status inválido');
    }
    return repository.list(normalized);
}

async function get(id) {
    if (!isPositiveId(id)) throw new BadRequestError('id de inscrição inválido');
    const enrollment = await repository.findById(id);
    if (!enrollment) throw new NotFoundError('inscrição não encontrada');
    return enrollment;
}

async function create(input, authorization) {
    const studentId = input.student_id ?? input.studentId;
    const courseId = input.course_id ?? input.class_id ?? input.classId;
    const enrollmentDate = input.enrollment_date ?? input.enrollmentDate
        ?? new Date().toISOString().slice(0, 10);
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const parsedDate = datePattern.test(String(enrollmentDate))
        ? new Date(`${enrollmentDate}T00:00:00.000Z`)
        : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime())
        || parsedDate.toISOString().slice(0, 10) !== enrollmentDate) {
        throw new BadRequestError('enrollmentDate inválida');
    }
    const academicYear = String(input.academic_year ?? input.academicYear ?? enrollmentDate.slice(0, 4));
    const status = input.status || 'active';
    if (!isPositiveId(studentId) || !isPositiveId(courseId)) {
        throw new BadRequestError('student_id e course_id são obrigatórios e devem ser positivos');
    }
    if (!/^[\w-]{1,20}$/.test(academicYear)) {
        throw new BadRequestError('academic_year inválido');
    }
    if (!['active', 'pending'].includes(status)) {
        throw new BadRequestError('status inicial deve ser active ou pending');
    }

    await dependencies.getStudent(studentId, authorization);
    const course = await dependencies.getCourse(courseId, authorization);
    const limit = courseLimit(course);

    const enrollment = await repository.transaction(async client => {
        await repository.lockCourse(client, courseId);
        const duplicate = await repository.findByStudentCourseYear(
            studentId,
            courseId,
            academicYear,
            client
        );
        if (duplicate) throw new ConflictError('inscrição já cadastrada');
        const existingCount = await repository.countActiveByCourse(courseId, client);
        if (status === 'active' && limit !== null && existingCount >= limit) {
            throw new ConflictError('limite de inscrições atingido');
        }
        const created = await repository.create({
            student_id: studentId,
            course_id: courseId,
            academic_year: academicYear,
            enrollment_date: enrollmentDate,
            status
        }, client);
        await publishEvent('enrollment.created', {
            enrollmentId: created.id,
            studentId: created.student_id,
            courseId: created.course_id,
            academicYear: created.academic_year,
            enrollmentDate: created.enrollment_date,
            status: created.status
        }, client);
        return created;
    });

    return enrollment;
}

async function updateStatus(id, status, authorization) {
    if (!VALID_STATUSES.has(status)) throw new BadRequestError('status inválido');
    if (!isPositiveId(id)) throw new BadRequestError('id de inscrição inválido');
    const current = await repository.findById(id);
    if (!current) throw new NotFoundError('inscrição não encontrada');

    let limit = null;
    if (status === 'active') {
        const course = await dependencies.getCourse(current.course_id, authorization);
        limit = courseLimit(course);
    }

    const updated = await repository.transaction(async client => {
        await repository.lockCourse(client, current.course_id);
        const latest = await repository.findById(id, client);
        if (!latest) throw new NotFoundError('inscrição não encontrada');
        if (status === 'active' && latest.status !== 'active') {
            const count = await repository.countActiveByCourse(current.course_id, client);
            if (limit !== null && count >= limit) {
                throw new ConflictError('limite de inscrições atingido');
            }
        }
        const changed = await repository.updateStatus(id, status, client);
        await publishEvent('enrollment.status_changed', {
            enrollmentId: changed.id,
            studentId: changed.student_id,
            courseId: changed.course_id,
            status: changed.status
        }, client);
        return changed;
    });

    return updated;
}

module.exports = { list, get, create, updateStatus };
