const repository = require('../repositories/classes.repository');
const { BadRequestError, NotFoundError } = require('../errors/AppError');
const { publishEvent } = require('../messaging/publisher');
const { withTransaction } = require('../config/db');
const { requireObject, requireId, requireText } = require('./validation');

const SHIFTS = ['morning', 'afternoon', 'evening'];

function validateClass(input, partial = false) {
    requireObject(input);
    const fields = {};
    if (!partial || input.name !== undefined) fields.name = requireText(input.name, 'name', 80);
    for (const field of ['school_year', 'capacity']) {
        if (!partial || input[field] !== undefined) {
            const value = input[field];
            if (!Number.isInteger(value) || value <= 0) {
                throw new BadRequestError(field === 'capacity'
                    ? 'capacity deve ser um inteiro positivo'
                    : 'school_year deve ser um inteiro positivo');
            }
            fields[field] = value;
        }
    }
    if (!partial || input.shift !== undefined) {
        if (!SHIFTS.includes(input.shift)) {
            throw new BadRequestError('shift deve ser morning, afternoon ou evening');
        }
        fields.shift = input.shift;
    }
    if (input.active !== undefined) {
        if (typeof input.active !== 'boolean') throw new BadRequestError('active deve ser booleano');
        fields.active = input.active;
    }
    if (partial && Object.keys(fields).length === 0) {
        throw new BadRequestError('informe ao menos um campo para atualizar');
    }
    return fields;
}

async function listClasses() {
    return repository.list();
}

async function getClass(idValue) {
    const id = requireId(idValue);
    const item = await repository.findById(id);
    if (!item) throw new NotFoundError('turma não encontrada');
    return item;
}

async function createClass(input) {
    const item = validateClass(input);
    return withTransaction(async client => {
        const created = await repository.create(item, client);
        await publishEvent('class.created', { classId: created.id }, client);
        return created;
    });
}

async function updateClass(idValue, input) {
    const id = requireId(idValue);
    const fields = validateClass(input, true);
    const updated = await repository.update(id, fields);
    if (!updated) throw new NotFoundError('turma não encontrada');
    return updated;
}

async function deleteClass(idValue) {
    const id = requireId(idValue);
    await withTransaction(async client => {
        const result = await repository.remove(id, client);
        if (!result.rowCount) throw new NotFoundError('turma não encontrada');
        await publishEvent('schedule.updated', { classId: id, change: 'class.deleted' }, client);
    });
}

async function getSchedule(idValue) {
    const item = await getClass(idValue);
    return { class: item, allocations: await repository.schedule(item.id) };
}

module.exports = {
    listClasses,
    getClass,
    createClass,
    updateClass,
    deleteClass,
    getSchedule,
    validateClass
};
