const { BadRequestError } = require('../errors/AppError');

function requireObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestError('corpo JSON inválido');
    }
}

function requireId(value, label = 'id') {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1) {
        throw new BadRequestError(`${label} deve ser um inteiro positivo`);
    }
    return id;
}

function requireText(value, label, maxLength, optional = false) {
    if (optional && value === undefined) return undefined;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
        throw new BadRequestError(`${label} é obrigatório e deve ter até ${maxLength} caracteres`);
    }
    return value.trim();
}

function requireYear(value, optional = false) {
    if (optional && value === undefined) return undefined;
    return requireText(value, 'school_year', 20);
}

function validateCreate(input, fields) {
    requireObject(input);
    const result = {};
    for (const [field, maxLength] of Object.entries(fields)) {
        result[field] = requireText(input[field], field, maxLength);
    }
    return result;
}

function validateUpdate(input, fields) {
    requireObject(input);
    const result = {};
    for (const [field, maxLength] of Object.entries(fields)) {
        if (input[field] !== undefined) result[field] = requireText(input[field], field, maxLength);
    }
    if (Object.keys(result).length === 0) throw new BadRequestError('informe ao menos um campo para atualizar');
    return result;
}

function requireTime(value, label) {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) {
        throw new BadRequestError(`${label} deve estar no formato HH:MM ou HH:MM:SS`);
    }
    return value.length === 5 ? `${value}:00` : value;
}

module.exports = {
    requireObject,
    requireId,
    requireText,
    requireYear,
    validateCreate,
    validateUpdate,
    requireTime
};
