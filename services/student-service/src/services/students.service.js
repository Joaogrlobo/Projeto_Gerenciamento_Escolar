// Regras e validações de gerenciamento de alunos.
const studentsRepository = require('../repositories/students.repository');
const { BadRequestError, NotFoundError } = require('../errors/AppError');
const { publishEvent } = require('../messaging/publisher');

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
    const created = await studentsRepository.create(student);
    await publishEvent('student.created', { studentId: created.id, registration: created.registration });
    return created;
}

async function updateStudent(id, student) {
    const updated = await studentsRepository.update(id, student);
    if (!updated) throw new NotFoundError('aluno não encontrado');
    await publishEvent('student.updated', { studentId: updated.id, registration: updated.registration });
    return updated;
}

async function deleteStudent(id) {
    const result = await studentsRepository.remove(id);
    if (!result.rowCount) throw new NotFoundError('aluno não encontrado');
    await publishEvent('student.deleted', { studentId: id });
}

module.exports = { listStudents, getStudent, createStudent, updateStudent, deleteStudent };
