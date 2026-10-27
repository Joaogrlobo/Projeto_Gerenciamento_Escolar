const { createHmac, timingSafeEqual } = require('node:crypto');

function decodeSegment(segment) {
    if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) {
        throw new Error('Invalid JWT segment');
    }

    return Buffer.from(segment, 'base64url');
}

function verifyJwt(token, secret) {
    if (typeof token !== 'string' || typeof secret !== 'string' || !secret) {
        throw new Error('JWT verification is not configured');
    }

    const segments = token.split('.');
    if (segments.length !== 3) {
        throw new Error('Malformed JWT');
    }

    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    const header = JSON.parse(decodeSegment(encodedHeader).toString('utf8'));
    const payload = JSON.parse(decodeSegment(encodedPayload).toString('utf8'));
    const signature = decodeSegment(encodedSignature);

    if (!header || header.alg !== 'HS256' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Unsupported JWT');
    }

    const expectedSignature = createHmac('sha256', secret)
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest();

    if (signature.length !== expectedSignature.length || !timingSafeEqual(signature, expectedSignature)) {
        throw new Error('Invalid JWT signature');
    }

    const now = Math.floor(Date.now() / 1000);
    if ((payload.exp !== undefined && (typeof payload.exp !== 'number' || now >= payload.exp)) ||
        (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || now < payload.nbf))) {
        throw new Error('JWT is expired or not active');
    }

    return payload;
}

function isPublicRequest(req) {
    const path = req.path.replace(/\/+$/, '') || '/';
    if (req.method === 'GET' && (path === '/health' || path === '/health/services')) {
        return true;
    }

    return req.method === 'POST' &&
        (path === '/api/auth/login' || path === '/api/auth/register');
}

function createAuthMiddleware(secret) {
    return function authenticate(req, res, next) {
        if (isPublicRequest(req)) {
            return next();
        }

        if (!secret) {
            return res.status(503).json({ error: 'Autenticação indisponível' });
        }

        const authorization = req.get('Authorization') || '';
        const match = /^Bearer ([^\s]+)$/i.exec(authorization);
        if (!match) {
            return res.status(401).json({ error: 'Token ausente ou inválido' });
        }

        try {
            req.user = verifyJwt(match[1], secret);
            return next();
        } catch {
            return res.status(401).json({ error: 'Token ausente ou inválido' });
        }
    };
}

module.exports = { createAuthMiddleware, verifyJwt };
