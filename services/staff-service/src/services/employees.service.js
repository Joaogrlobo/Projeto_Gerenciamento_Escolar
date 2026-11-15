// Regras e validações de gerenciamento de funcionários.
const employeesRepository = require('../repositories/employees.repository');
const { BadRequestError, NotFoundError } = require('../errors/AppError');
const { publishEvent } = require('../messaging/publisher');
const { withTransaction } = require('../config/db');

const TYPES = ['teacher', 'admin_staff'];

function ensureId(id) {
    if (!/^\d+$/.test(String(id)) || Number(id) < 1 || Number(id) > 2147483647) {
        throw new BadRequestError('id de funcionário inválido');
    }
}

function listEmployees(query, type) {
    return employeesRepository.list(`%${query || ''}%`, type);
}

async function getEmployee(id) {
    ensureId(id);
    const employee = await employeesRepository.findById(id);
    if (!employee) throw new NotFoundError('funcionário não encontrado');
    return employee;
}

async function createEmployee(employee) {
    const { type, name, email } = employee;
    if (!TYPES.includes(type) || !name || typeof email !== 'string' || !email.trim()) {
        throw new BadRequestError('type (teacher|admin_staff), name e email são obrigatórios');
    }
    return withTransaction(async client => {
        const created = await employeesRepository.create({ ...employee, email: email.toLowerCase() }, client);
        await publishEvent('employee.created', { employeeId: created.id, type: created.type }, client);
        return created;
    });
}

async function updateEmployee(id, employee) {
    ensureId(id);
    return withTransaction(async client => {
        const updated = await employeesRepository.update(id, employee, client);
        if (!updated) throw new NotFoundError('funcionário não encontrado');
        await publishEvent('employee.updated', { employeeId: updated.id, type: updated.type }, client);
        return updated;
    });
}

async function deleteEmployee(id) {
    ensureId(id);
    await withTransaction(async client => {
        const result = await employeesRepository.remove(id, client);
        if (!result.rowCount) throw new NotFoundError('funcionário não encontrado');
        await publishEvent('employee.deleted', { employeeId: id }, client);
    });
}

module.exports = { listEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee };
