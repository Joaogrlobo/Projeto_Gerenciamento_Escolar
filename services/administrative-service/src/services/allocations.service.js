const allocationsRepository = require('../repositories/allocations.repository');
const classesRepository = require('../repositories/classes.repository');
const subjectsRepository = require('../repositories/subjects.repository');
const teachersService = require('./teachers.service');
const { BadRequestError, ConflictError, NotFoundError } = require('../errors/AppError');
const { publishEvent } = require('../messaging/publisher');
const { requireId, requireObject, requireText, requireTime } = require('./validation');

const CONFLICT_MESSAGES = {
    teacher: 'Conflito de horário: professor já possui uma alocação nesse período.',
    class: 'Conflito de horário: turma já possui uma alocação nesse período.',
    room: 'Conflito de horário: sala já possui uma alocação nesse período.'
};

function validateAllocation(input) {
    requireObject(input);
    const classId = requireId(input.class_id, 'class_id');
    const subjectId = requireId(input.subject_id, 'subject_id');
    const teacherId = requireId(input.teacher_id, 'teacher_id');
    const weekday = input.weekday;
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 1 || weekday > 5) {
        throw new BadRequestError('weekday deve ser um inteiro entre 1 (segunda-feira) e 5 (sexta-feira)');
    }
    const startTime = requireTime(input.start_time, 'start_time');
    const endTime = requireTime(input.end_time, 'end_time');
    if (startTime >= endTime) throw new BadRequestError('end_time deve ser posterior a start_time');
    return {
        class_id: classId,
        subject_id: subjectId,
        teacher_id: teacherId,
        room: input.room == null ? null : requireText(input.room, 'room', 80),
        weekday,
        start_time: startTime,
        end_time: endTime
    };
}

async function ensureReferences(item) {
    const classRecord = await classesRepository.findById(item.class_id);
    if (!classRecord) {
        throw new NotFoundError('turma não encontrada');
    }
    if (!await subjectsRepository.findById(item.subject_id)) {
        throw new NotFoundError('disciplina não encontrada');
    }
}

async function validateNoConflicts(item, database) {
    for (const resource of ['teacher', 'class', 'room']) {
        if (await allocationsRepository.findScheduleConflict(item, resource, undefined, database)) {
            throw new ConflictError(CONFLICT_MESSAGES[resource]);
        }
    }
}

async function listAllocations(query) {
    const filters = {};
    for (const field of ['class_id', 'teacher_id', 'weekday']) {
        if (query[field] !== undefined) {
            const parsed = Number(query[field]);
            if (!Number.isInteger(parsed) || parsed < 1
                || (field === 'weekday' && (parsed < 1 || parsed > 5))) {
                throw new BadRequestError(`${field} inválido`);
            }
            filters[field] = parsed;
        }
    }
    if (query.school_year !== undefined) {
        const schoolYear = Number(query.school_year);
        if (!Number.isInteger(schoolYear)) throw new BadRequestError('school_year inválido');
        filters.school_year = schoolYear;
    }
    return allocationsRepository.list(filters);
}

async function createAllocation(input, authorization) {
    const item = validateAllocation(input);
    await ensureReferences(item);
    await teachersService.ensureTeacher(item.teacher_id, authorization);
    const created = await allocationsRepository.withScheduleLock(async database => {
        await validateNoConflicts(item, database);
        return allocationsRepository.create(item, database);
    });
    const data = {
        allocationId: created.id,
        teacherId: created.teacher_id,
        classId: created.class_id,
        subjectId: created.subject_id
    };
    await publishEvent('teacher.assigned', data);
    await publishEvent('schedule.updated', data);
    return created;
}

async function deleteAllocation(idValue) {
    const id = requireId(idValue, 'allocation id');
    const existing = await allocationsRepository.findById(id);
    if (!existing) throw new NotFoundError('alocação não encontrada');
    await allocationsRepository.remove(id);
    const data = {
        allocationId: id,
        teacherId: existing.teacher_id,
        classId: existing.class_id,
        change: 'deleted'
    };
    await publishEvent('schedule.updated', data);
}

async function getTeacherSchedule(idValue, authorization) {
    const teacherId = requireId(idValue, 'teacherId');
    await teachersService.ensureTeacher(teacherId, authorization);
    return { teacherId, allocations: await allocationsRepository.teacherSchedule(teacherId) };
}

module.exports = {
    listAllocations,
    createAllocation,
    deleteAllocation,
    getTeacherSchedule,
    validateAllocation
};
