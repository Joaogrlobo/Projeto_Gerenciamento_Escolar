// Regras para formar e consultar notificações de eventos.
const notificationsRepository = require('../repositories/notifications.repository');
const { BadRequestError } = require('../errors/AppError');

function firstValue(data, ...keys) {
    for (const key of keys) {
        const value = data?.[key];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
}

function subject(data, ...keys) {
    return firstValue(data, ...keys) ?? 'desconhecido';
}

function formatMessage(type, data) {
    switch (type) {
        case 'student.created':
            return `Aluno cadastrado: ${subject(data, 'name', 'studentName', 'student_name', 'registration', 'studentId', 'student_id')}`;
        case 'enrollment.created':
            return `Matrícula criada: aluno ${subject(data, 'studentName', 'student_name', 'studentId', 'student_id')} em ${subject(data, 'courseName', 'course_name', 'className', 'class_name', 'courseId', 'course_id', 'enrollmentId', 'enrollment_id')}`;
        case 'grade.posted':
            return `Nota lançada: aluno ${subject(data, 'studentName', 'student_name', 'studentId', 'student_id')} — ${subject(data, 'subject', 'courseName', 'course_name', 'courseId', 'course_id')}: ${subject(data, 'grade', 'score', 'value')}`;
        case 'attendance.recorded': {
            const status = firstValue(data, 'status', 'attendanceStatus', 'attendance_status', 'attendance');
            const absent = status
                ? String(status).toLowerCase() === 'absent'
                : data?.present === false || data?.isPresent === false || data?.absent === true;
            const attendance = absent ? 'ausente' : 'presente';
            return `Frequência registrada: aluno ${subject(data, 'studentName', 'student_name', 'studentId', 'student_id')} ${attendance}`;
        }
        case 'teacher.assigned':
            return `Professor ${subject(data, 'teacherName', 'teacher_name', 'teacherId', 'teacher_id')} atribuído a ${subject(data, 'courseName', 'course_name', 'className', 'class_name', 'classId', 'class_id', 'courseId', 'course_id')}`;
        default:
            return type;
    }
}

async function recordEvent(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new BadRequestError('evento inválido');
    }
    const eventId = event.event_id || event.eventId || event.id;
    if (!eventId || typeof eventId !== 'string' || typeof event.type !== 'string' || !event.type) {
        throw new BadRequestError('evento sem identificador ou tipo');
    }
    const payload = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
        ? event.data
        : {};
    return notificationsRepository.insert({
        eventId,
        type: event.type,
        message: formatMessage(event.type, payload),
        payload,
        occurredAt: event.occurredAt || event.occurred_at || null
    });
}

async function listNotifications(type, limit) {
    let parsedLimit = 50;
    if (limit !== undefined) {
        parsedLimit = Number(limit);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
            throw new BadRequestError('limit deve ser um inteiro entre 1 e 200');
        }
    }
    return notificationsRepository.list(type || null, Math.min(parsedLimit, 200));
}

module.exports = { recordEvent, listNotifications, formatMessage };
