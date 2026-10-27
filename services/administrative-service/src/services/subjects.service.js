const repository = require('../repositories/subjects.repository');
const { BadRequestError, NotFoundError } = require('../errors/AppError');
const { requireId, requireObject, requireText } = require('./validation');
const { publishEvent } = require('../messaging/publisher');

function validateSubject(input, partial = false) {
    requireObject(input);
    const fields = {};
    if (!partial || input.name !== undefined) fields.name = requireText(input.name, 'name', 120);
    if (!partial || input.workload_hours !== undefined) {
        if (!Number.isInteger(input.workload_hours) || input.workload_hours < 1) {
            throw new BadRequestError('workload_hours deve ser um inteiro positivo');
        }
        fields.workload_hours = input.workload_hours;
    }
    if (partial && Object.keys(fields).length === 0) {
        throw new BadRequestError('informe ao menos um campo para atualizar');
    }
    return fields;
}

async function listSubjects() {
    return repository.list();
}

async function getSubject(idValue) {
    const item = await repository.findById(requireId(idValue));
    if (!item) throw new NotFoundError('disciplina não encontrada');
    return item;
}

async function createSubject(input) {
    return repository.create(validateSubject(input));
}

async function updateSubject(idValue, input) {
    const id = requireId(idValue);
    const fields = validateSubject(input, true);
    const item = await repository.update(id, fields);
    if (!item) throw new NotFoundError('disciplina não encontrada');
    return item;
}

async function deleteSubject(idValue) {
    const id = requireId(idValue);
    const result = await repository.remove(id);
    if (!result.rowCount) throw new NotFoundError('disciplina não encontrada');
    await publishEvent('schedule.updated', { subjectId: id, change: 'subject.deleted' });
}

module.exports = {
    listSubjects,
    getSubject,
    createSubject,
    updateSubject,
    deleteSubject,
    validateSubject
};
