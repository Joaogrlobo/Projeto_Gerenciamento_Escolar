const config = require('../config/env');
const { AppError, ConflictError, NotFoundError, ServiceUnavailableError } = require('../errors/AppError');
const { createResilientCall } = require('../resilience/resilient-call');

const UNAVAILABLE_MESSAGE = 'serviço de funcionários indisponível';
const ATTEMPT_TIMEOUT_MS = 1200;
const staffCall = createResilientCall('staff-service', {
    onUnavailable: () => new ServiceUnavailableError(UNAVAILABLE_MESSAGE)
});

async function fetchEmployee(teacherId, authorization) {
    let response;
    try {
        response = await fetch(`${config.staffServiceUrl}/employees/${teacherId}`, {
            headers: { Authorization: authorization },
            signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)
        });
    } catch {
        throw new ServiceUnavailableError(UNAVAILABLE_MESSAGE);
    }

    if (response.status === 404) throw new NotFoundError('professor não encontrado');
    if (response.status >= 500) throw new ServiceUnavailableError(UNAVAILABLE_MESSAGE);
    if (!response.ok) throw new AppError(response.status, 'falha ao consultar professor');

    try {
        return await response.json();
    } catch {
        throw new ServiceUnavailableError(UNAVAILABLE_MESSAGE);
    }
}

async function ensureTeacher(teacherId, authorization, { requireActive = false } = {}) {
    const employee = await staffCall(() => fetchEmployee(teacherId, authorization));
    if (!employee || employee.type !== 'teacher') {
        throw new NotFoundError('professor não encontrado');
    }
    if (requireActive && employee.active === false) {
        throw new ConflictError('professor inativo');
    }
    return employee;
}

module.exports = { ensureTeacher };
