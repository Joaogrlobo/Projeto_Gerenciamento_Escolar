// Adaptador HTTP dos endpoints de alunos.
const studentsService = require('../services/students.service');

async function list(req, res) {
    res.json(await studentsService.listStudents(req.query.q));
}

async function get(req, res) {
    res.json(await studentsService.getStudent(req.params.id));
}

async function create(req, res) {
    res.status(201).json(await studentsService.createStudent(req.body));
}

async function update(req, res) {
    res.json(await studentsService.updateStudent(req.params.id, req.body));
}

async function remove(req, res) {
    await studentsService.deleteStudent(req.params.id);
    res.status(204).end();
}

module.exports = { list, get, create, update, remove };
