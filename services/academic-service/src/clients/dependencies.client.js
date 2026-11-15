// Cliente HTTP dos serviços de alunos e administrativos com timeout controlado.
const config = require('../config/env');
const {
    AppError,
    NotFoundError,
    ServiceUnavailableError
} = require('../errors/AppError');
const { createResilientCall } = require('../resilience/resilient-call');

const ATTEMPT_TIMEOUT_MS = 1200;
const onUnavailable = () => new ServiceUnavailableError();
const studentCall = createResilientCall('student-service', { onUnavailable });
const administrativeCall = createResilientCall('administrative-service', { onUnavailable });

async function getEntity(baseUrl, resource, id, authorization, entityName) {
    if (!baseUrl) throw new ServiceUnavailableError();
    let response;
    try {
        response = await fetch(`${baseUrl.replace(/\/+$/, '')}/${resource}/${encodeURIComponent(id)}`, {
            method: 'GET',
            headers: { authorization },
            signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)
        });
    } catch {
        throw new ServiceUnavailableError();
    }

    if (response.status === 404) {
        throw new NotFoundError(entityName === 'aluno' ? 'aluno não encontrado' : 'turma não encontrada');
    }
    if (response.status >= 500) throw new ServiceUnavailableError();
    if (!response.ok) {
        throw new AppError(response.status, `falha ao consultar ${entityName}`);
    }

    try {
        return await response.json();
    } catch {
        throw new ServiceUnavailableError();
    }
}

function validateEntity(body, entityName) {
    if (!body || (typeof body !== 'object') || body.error) {
        throw new ServiceUnavailableError();
    }
    const entity = body[entityName] || body.data || body;
    if (entity && (entity.id === undefined || entity.id === null)) {
        throw new ServiceUnavailableError();
    }
    if (entity && entity.active === false) {
        throw new NotFoundError(entityName === 'student' ? 'aluno não encontrado' : 'turma não encontrada');
    }
    return entity;
}

async function getStudent(id, authorization) {
    const response = await studentCall(
        () => getEntity(config.studentServiceUrl, 'students', id, authorization, 'aluno')
    );
    return validateEntity(response, 'student');
}

async function getCourse(id, authorization) {
    const response = await administrativeCall(() => getEntity(
        config.administrativeServiceUrl,
        'classes',
        id,
        authorization,
        'turma'
    ));
    return validateEntity(response, 'class');
}

module.exports = { getStudent, getCourse };
