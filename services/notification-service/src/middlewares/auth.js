// Autentica JWT e autoriza operações por perfil.
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { UnauthorizedError, ForbiddenError } = require('../errors/AppError');

function authenticate(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return next(new UnauthorizedError('token ausente'));
    try {
        req.user = jwt.verify(token, config.jwtSecret);
        next();
    } catch {
        next(new UnauthorizedError('token inválido ou expirado'));
    }
}

const requireRole = (...roles) => (req, res, next) =>
    roles.includes(req.user?.role) ? next() : next(new ForbiddenError('sem permissão'));

module.exports = { authenticate, requireRole };
