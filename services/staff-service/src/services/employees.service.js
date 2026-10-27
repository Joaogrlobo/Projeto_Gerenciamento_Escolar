// Regras e validações de gerenciamento de funcionários.
const employeesRepository = require('../repositories/employees.repository');
const { BadRequestError, NotFoundError } = require('../errors/AppError');
const { publishEvent } = require('../messaging/publisher');

const TYPES = ['teacher', 'admin_staff'];

function listEmployees(query, type) {
    return employeesRepository.list(`%${query || ''}%`, type);
}

async function getEmployee(id) {
    const employee = await employeesRepository.findById(id);
    if (!employee) throw new NotFoundError('funcionário não encontrado');
    return employee;
}

async function createEmployee(employee) {
    const { type, name, email } = employee;
    if (!TYPES.includes(type) || !name || !email) {
        throw new BadRequestError('type (teacher|admin_staff), name e email são obrigatórios');
    }
    const created = await employeesRepository.create({ ...employee, email: email.toLowerCase() });
    await publishEvent('employee.created', { employeeId: created.id, type: created.type });
    return created;
}

async function updateEmployee(id, employee) {
    const updated = await employeesRepository.update(id, employee);
    if (!updated) throw new NotFoundError('funcionário não encontrado');
    await publishEvent('employee.updated', { employeeId: updated.id, type: updated.type });
    return updated;
}

async function deleteEmployee(id) {
    const result = await employeesRepository.remove(id);
    if (!result.rowCount) throw new NotFoundError('funcionário não encontrado');
    await publishEvent('employee.deleted', { employeeId: id });
}

module.exports = { listEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee };
