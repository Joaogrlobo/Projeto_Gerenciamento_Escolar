const service = require('../services/subjects.service');

async function list(req, res) {
    res.json(await service.listSubjects());
}

async function get(req, res) {
    res.json(await service.getSubject(req.params.id));
}

async function create(req, res) {
    res.status(201).json(await service.createSubject(req.body));
}

async function update(req, res) {
    res.json(await service.updateSubject(req.params.id, req.body));
}

async function remove(req, res) {
    await service.deleteSubject(req.params.id);
    res.status(204).end();
}

module.exports = { list, get, create, update, remove };
