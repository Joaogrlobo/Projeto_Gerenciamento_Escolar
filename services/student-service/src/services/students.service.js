// Regras e validações de gerenciamento de alunos.
const studentsRepository = require('../repositories/students.repository');
const { BadRequestError, NotFoundError } = require('../errors/AppError');
const { publishEvent } = require('../messaging/publisher');
const { withTransaction } = require('../config/db');

function listStudents(query) {
    return studentsRepository.list(`%${query || ''}%`);
}

async function getStudent(id) {
    const student = await studentsRepository.findById(id);
    if (!student) throw new NotFoundError('aluno não encontrado');
    return student;
}

async function createStudent(student) {
    const { registration, name } = student;
    if (!registration || !name) {
        throw new BadRequestError('registration e name são obrigatórios');
    }
    return withTransaction(async client => {
        const created = await studentsRepository.create(student, client);
        await publishEvent('student.created', { studentId: created.id, registration: created.registration }, client);
        return created;
    });
}

async function updateStudent(id, student) {
    return withTransaction(async client => {
        const updated = await studentsRepository.update(id, student, client);
        if (!updated) throw new NotFoundError('aluno não encontrado');
        await publishEvent('student.updated', { studentId: updated.id, registration: updated.registration }, client);
        return updated;
    });
}

async function deleteStudent(id) {
    await withTransaction(async client => {
        const result = await studentsRepository.remove(id, client);
        if (!result.rowCount) throw new NotFoundError('aluno não encontrado');
        await publishEvent('student.deleted', { studentId: id }, client);
    });
}

module.exports = { listStudents, getStudent, createStudent, updateStudent, deleteStudent };
