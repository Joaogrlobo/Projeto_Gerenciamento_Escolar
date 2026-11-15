const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const config = require('./config/env');
const routes = require('./config/routes');
const accessLog = require('./middlewares/access-log');
const { createAuthMiddleware } = require('./middlewares/auth');
const createRateLimiters = require('./middlewares/rate-limit');
const requestId = require('./middlewares/request-id');
const { getBreaker, circuitStates } = require('./resilience/proxy-breakers');

const app = express();
const rateLimiters = createRateLimiters(config.loginRateLimit);

app.disable('x-powered-by');
app.use(requestId);
app.use(accessLog);
app.use((req, res, next) => {
    const origin = req.get('Origin');
    const originAllowed = origin && (config.corsOrigin === '*' || origin === config.corsOrigin);

    if (originAllowed) {
        res.set('Access-Control-Allow-Origin', config.corsOrigin === '*' ? '*' : origin);
        if (config.corsOrigin !== '*') {
            res.vary('Origin');
        }
    }

    if (req.method === 'OPTIONS') {
        if (originAllowed) {
            res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
            const requestedHeaders = req.get('Access-Control-Request-Headers');
            if (requestedHeaders) {
                res.set('Access-Control-Allow-Headers', requestedHeaders);
            }
        }
        return res.sendStatus(204);
    }

    next();
});
app.use(rateLimiters.general);

app.get('/health', (_req, res) => {
    res.json({ status: 'UP', service: 'api-gateway' });
});

app.get('/health/services', async (_req, res) => {
    const circuits = circuitStates();
    const serviceChecks = Object.entries(config.services).map(async ([service, baseUrl]) => {
        try {
            const response = await fetch(`${baseUrl}/health`, {
                signal: AbortSignal.timeout(config.serviceHealthTimeoutMs)
            });
            return [service, { status: response.ok ? 'UP' : 'DOWN', circuit: circuits[service] }];
        } catch {
            return [service, { status: 'DOWN', circuit: circuits[service] }];
        }
    });

    const services = Object.fromEntries(await Promise.all(serviceChecks));
    const status = Object.values(services).every(({ status: serviceStatus }) => serviceStatus === 'UP')
        ? 'UP'
        : 'DOWN';

    res.status(200).json({ status, services });
});

app.post('/api/auth/login', rateLimiters.login);

app.use(createAuthMiddleware(config.jwtSecret));

for (const route of routes) {
    const routePrefixPattern = new RegExp(
        `^${route.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/|\\?|$)`
    );
    const proxy = createProxyMiddleware({
        target: config.services[route.service],
        changeOrigin: true,
        proxyTimeout: 10_000,
        pathRewrite: route.stripServicePrefix
            ? (path) => {
                const rewrittenPath = path.replace(routePrefixPattern, '');
                return rewrittenPath.startsWith('/') ? rewrittenPath : `/${rewrittenPath}`;
            }
            : route.stripApiPrefix
                ? (path) => path.replace(/^\/api(?=\/|$)/, '')
                : undefined,
        on: {
            // O gateway é a única autoridade de CORS para o navegador: descarta os headers
            // Access-Control-* dos serviços para que não sobrescrevam os definidos acima.
            proxyRes: (proxyRes) => {
                for (const header of Object.keys(proxyRes.headers)) {
                    if (header.startsWith('access-control-')) {
                        delete proxyRes.headers[header];
                    }
                }
            },
            error: (error, _req, res) => {
                if (res?.locals) {
                    res.locals.upstreamFailed = true;
                }
                if (!res || res.headersSent || res.writableEnded) {
                    return;
                }

                const timedOut = ['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED'].includes(error.code) ||
                    /timed?\s*out|timeout/i.test(error.message || '');
                res.status(timedOut ? 504 : 503).json({
                    error: timedOut ? 'Tempo limite do serviço excedido' : 'Serviço indisponível'
                });
            }
        }
    });

    const breaker = getBreaker(route.service);

    app.use(route.prefix, (req, res, next) => {
        req.url = req.originalUrl;
        const timeout = setTimeout(() => {
            if (!res.headersSent && !res.writableEnded) {
                res.locals.upstreamFailed = true;
                res.status(504).json({ error: 'Tempo limite do serviço excedido' });
            }
        }, 10_000);
        res.once('finish', () => clearTimeout(timeout));
        res.once('close', () => clearTimeout(timeout));
        breaker.fire(proxy, req, res, next).catch((error) => {
            if (error.code === 'EOPENBREAKER') {
                res.set('Retry-After', String(Math.ceil(config.circuitResetMs / 1000)));
                res.status(503).json({ error: 'Serviço temporariamente indisponível' });
            }
        });
    });
}

const notificationsSocket = createProxyMiddleware({
    target: config.services['notification-service'],
    changeOrigin: true,
    on: {
        error: (_error, _req, socket) => socket.destroy?.()
    }
});

app.handleUpgrade = (req, socket, head) => {
    if (req.url.split('?')[0] !== '/ws/notifications') {
        socket.destroy();
        return;
    }
    notificationsSocket.upgrade(req, socket, head);
};

app.use((_req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

app.use((error, _req, res, _next) => {
    console.error('Erro não tratado no gateway:', error);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Erro interno do gateway' });
    }
});

module.exports = app;
