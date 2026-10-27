const service = require('../services/classes.service');

async function list(req, res) {
    res.json(await service.listClasses());
}

async function get(req, res) {
    res.json(await service.getClass(req.params.id));
}

async function create(req, res) {
    res.status(201).json(await service.createClass(req.body));
}

async function update(req, res) {
    res.json(await service.updateClass(req.params.id, req.body));
}

async function remove(req, res) {
    await service.deleteClass(req.params.id);
    res.status(204).end();
}

async function schedule(req, res) {
    res.json(await service.getSchedule(req.params.id));
}

module.exports = { list, get, create, update, remove, schedule };
