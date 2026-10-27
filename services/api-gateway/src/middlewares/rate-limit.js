const { rateLimit } = require('express-rate-limit');

function createRateLimiters(loginLimit) {
    const options = {
        windowMs: 60 * 1000,
        standardHeaders: true,
        legacyHeaders: false,
        handler: (_req, res) => res.status(429).json({ error: 'Limite de requisições excedido' })
    };

    return {
        general: rateLimit({ ...options, limit: 300 }),
        login: rateLimit({ ...options, limit: loginLimit })
    };
}

module.exports = createRateLimiters;
