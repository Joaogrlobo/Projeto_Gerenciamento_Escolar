// Mantém um Circuit Breaker por serviço para as requisições encaminhadas.
const CircuitBreaker = require('opossum');
const config = require('../config/env');

const ROLLING_WINDOW_MS = 60000;
const breakers = new Map();

// Só falha de conexão ou timeout conta: um 503 respondido pelo serviço prova que ele está no ar.
function forward(proxy, req, res, next) {
    return new Promise((resolve, reject) => {
        res.once('close', () => {
            if (res.locals.upstreamFailed) reject(new Error('falha ao alcançar o serviço'));
            else resolve();
        });
        proxy(req, res, next);
    });
}

function getBreaker(service) {
    if (!breakers.has(service)) {
        breakers.set(service, new CircuitBreaker(forward, {
            name: service,
            timeout: false,
            resetTimeout: config.circuitResetMs,
            rollingCountTimeout: ROLLING_WINDOW_MS,
            volumeThreshold: 5,
            errorThresholdPercentage: 50
        }));
    }
    return breakers.get(service);
}

function stateOf(breaker) {
    if (breaker.halfOpen) return 'HALF_OPEN';
    return breaker.opened ? 'OPEN' : 'CLOSED';
}

function circuitStates() {
    return Object.fromEntries([...breakers].map(([service, breaker]) => [service, stateOf(breaker)]));
}

module.exports = { getBreaker, circuitStates };
