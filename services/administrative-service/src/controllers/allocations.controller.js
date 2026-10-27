const service = require('../services/allocations.service');
const { BadRequestError } = require('../errors/AppError');

async function list(req, res) {
    res.json(await service.listAllocations(req.query));
}

async function create(req, res) {
    res.status(201).json(await service.createAllocation(req.body, req.headers.authorization));
}

async function remove(req, res) {
    const id = req.params.id ?? req.query.id ?? req.body?.id;
    if (id === undefined) throw new BadRequestError('allocation id é obrigatório');
    await service.deleteAllocation(id);
    res.status(204).end();
}

async function teacherSchedule(req, res) {
    res.json(await service.getTeacherSchedule(req.params.teacherId, req.headers.authorization));
}

module.exports = { list, create, remove, teacherSchedule };
