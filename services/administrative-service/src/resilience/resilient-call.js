// Combina novas tentativas e Circuit Breaker para chamadas a outros serviços.
const CircuitBreaker = require('opossum');

// Janela longa: uma falha lenta consome até 4 s, e cinco delas precisam caber na contagem.
const ROLLING_WINDOW_MS = 60000;
const circuits = new Map();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function stateOf(breaker) {
    if (breaker.halfOpen) return 'HALF_OPEN';
    return breaker.opened ? 'OPEN' : 'CLOSED';
}

function createResilientCall(name, {
    attempts = 3,
    backoffMs = [150, 300],
    resetTimeoutMs = 10000,
    volumeThreshold = 5,
    errorThresholdPercentage = 50,
    onUnavailable
}) {
    async function withRetry(operation) {
        for (let attempt = 1; ; attempt += 1) {
            try {
                return await operation();
            } catch (error) {
                if (error?.statusCode !== 503 || attempt >= attempts) throw error;
                await wait(backoffMs[attempt - 1] ?? backoffMs.at(-1));
            }
        }
    }

    const breaker = new CircuitBreaker(withRetry, {
        name,
        timeout: false,
        resetTimeout: resetTimeoutMs,
        rollingCountTimeout: ROLLING_WINDOW_MS,
        volumeThreshold,
        errorThresholdPercentage,
        errorFilter: error => error?.statusCode < 500
    });

    async function call(operation) {
        try {
            return await breaker.fire(operation);
        } catch (error) {
            if (error?.code === 'EOPENBREAKER') throw onUnavailable();
            throw error;
        }
    }

    call.state = () => stateOf(breaker);
    circuits.set(name, call);
    return call;
}

function circuitStates() {
    return Object.fromEntries([...circuits].map(([name, call]) => [name, call.state()]));
}

module.exports = { createResilientCall, circuitStates };
