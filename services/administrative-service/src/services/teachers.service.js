const config = require('../config/env');
const { NotFoundError, ServiceUnavailableError } = require('../errors/AppError');

async function ensureTeacher(teacherId, authorization) {
    let response;
    try {
        response = await fetch(`${config.staffServiceUrl}/employees/${teacherId}`, {
            headers: { Authorization: authorization },
            signal: AbortSignal.timeout(5000)
        });
    } catch {
        throw new ServiceUnavailableError('serviço de funcionários indisponível');
    }

    if (response.status === 404) throw new NotFoundError('professor não encontrado');
    if (!response.ok) throw new ServiceUnavailableError('serviço de funcionários indisponível');

    let employee;
    try {
        employee = await response.json();
    } catch {
        throw new ServiceUnavailableError('serviço de funcionários indisponível');
    }
    if (!employee || employee.type !== 'teacher') {
        throw new NotFoundError('professor não encontrado');
    }
    return employee;
}

module.exports = { ensureTeacher };
