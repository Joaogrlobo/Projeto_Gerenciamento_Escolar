// Erros esperados da aplicação com o status HTTP correspondente.
class AppError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.name = 'AppError';
        this.statusCode = statusCode;
    }
}

class BadRequestError extends AppError {
    constructor(message) { super(400, message); }
}

class UnauthorizedError extends AppError {
    constructor(message) { super(401, message); }
}

class ForbiddenError extends AppError {
    constructor(message) { super(403, message); }
}

class NotFoundError extends AppError {
    constructor(message) { super(404, message); }
}

class ConflictError extends AppError {
    constructor(message) { super(409, message); }
}

class ServiceUnavailableError extends AppError {
    constructor() { super(503, 'serviço dependente indisponível'); }
}

module.exports = {
    AppError,
    BadRequestError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    ServiceUnavailableError
};
