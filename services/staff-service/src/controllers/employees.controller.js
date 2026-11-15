// Adaptador HTTP dos endpoints de funcionários.
const employeesService = require('../services/employees.service');

async function list(req, res) {
    res.json(await employeesService.listEmployees(req.query.q, req.query.type));
}

async function get(req, res) {
    res.json(await employeesService.getEmployee(req.params.id));
}

async function create(req, res) {
    res.status(201).json(await employeesService.createEmployee(req.body ?? {}));
}

async function update(req, res) {
    res.json(await employeesService.updateEmployee(req.params.id, req.body ?? {}));
}

async function remove(req, res) {
    await employeesService.deleteEmployee(req.params.id);
    res.status(204).end();
}

module.exports = { list, get, create, update, remove };
