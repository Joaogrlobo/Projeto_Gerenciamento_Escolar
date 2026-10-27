const jwt = require('jsonwebtoken');
const config = require('../config/env');

function authenticate(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'token ausente' });
    try {
        req.user = jwt.verify(token, config.jwtSecret);
        next();
    } catch {
        res.status(401).json({ error: 'token inválido ou expirado' });
    }
}

const requireRole = (...roles) => (req, res, next) =>
    roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'sem permissão' });

module.exports = { authenticate, requireRole };
