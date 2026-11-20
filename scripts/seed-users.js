#!/usr/bin/env node
// Cria as contas de usuário listadas em um CSV usando apenas a API pública (gateway).
// Uso: node scripts/seed-users.js [--file scripts/data/usuarios-testes.csv] [--base-url http://localhost:8080]
// Lê ADMIN_EMAIL/ADMIN_PASSWORD do ambiente ou do .env da raiz. Pode rodar várias vezes: quem já existe é mantido.
'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_COLUMNS = ['name', 'email', 'role', 'password'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const header = lines.shift().split(',').map((column) => column.trim());
    if (!REQUIRED_COLUMNS.every((column) => header.includes(column))) {
        throw new Error(`o CSV precisa das colunas obrigatórias: ${REQUIRED_COLUMNS.join(', ')}`);
    }
    return lines.map((line) => {
        const values = line.split(',').map((value) => value.trim());
        return Object.fromEntries(REQUIRED_COLUMNS.map((column) => [column, values[header.indexOf(column)]]));
    });
}

async function seedUsers(rows, api, adminEmail) {
    const summary = { created: 0, existing: 0, skipped: 0, failed: [] };
    for (const { name, email, role, password } of rows) {
        if (email.toLowerCase() === String(adminEmail).toLowerCase()) {
            summary.skipped += 1;
            continue;
        }
        const response = await api('POST', '/api/users', { name, email, role, password });
        if (response.status === 201) summary.created += 1;
        else if (response.status === 409) summary.existing += 1;
        else summary.failed.push({ email, reason: `HTTP ${response.status}: ${response.error}` });
    }
    return summary;
}

function loadEnv() {
    const file = path.join(__dirname, '..', '.env');
    const env = {};
    if (fs.existsSync(file)) {
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
            if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
        }
    }
    return {
        email: process.env.ADMIN_EMAIL || env.ADMIN_EMAIL || 'admin@distrischool.com',
        password: process.env.ADMIN_PASSWORD || env.ADMIN_PASSWORD || 'admin123'
    };
}

// Repete após 429 (rate limit) ou 503 (Circuit Breaker aberto), respeitando o tempo pedido pelo gateway.
function createApi(baseUrl, token) {
    return async function api(method, route, body) {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const response = await fetch(`${baseUrl}${route}`, {
                method,
                headers: {
                    'content-type': 'application/json',
                    ...(token ? { authorization: `Bearer ${token}` } : {})
                },
                body: body === undefined ? undefined : JSON.stringify(body)
            });
            if (response.status === 429 || response.status === 503) {
                const wait = Number(response.headers.get('retry-after') || response.headers.get('ratelimit-reset') || 5);
                console.log(`  aguardando ${wait}s (HTTP ${response.status})...`);
                await sleep(wait * 1000);
                continue;
            }
            const text = await response.text();
            let data = null;
            try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
            return { status: response.status, error: data?.error || data?.message, data };
        }
        return { status: 503, error: 'limite de tentativas atingido' };
    };
}

function argument(name, fallback) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
    const baseUrl = argument('--base-url', process.env.BASE_URL || 'http://localhost:8080');
    const file = argument('--file', path.join(__dirname, 'data', 'usuarios-testes.csv'));
    const admin = loadEnv();
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    console.log(`Seed de ${rows.length} usuários de ${path.relative(process.cwd(), file)} em ${baseUrl}`);

    const health = await fetch(`${baseUrl}/health`).catch(() => null);
    if (!health || !health.ok) throw new Error('gateway indisponível; suba o ambiente com docker compose up -d');

    const login = await createApi(baseUrl)('POST', '/api/auth/login', { email: admin.email, password: admin.password });
    if (login.status !== 200) throw new Error(`login do administrador falhou (HTTP ${login.status})`);

    const summary = await seedUsers(rows, createApi(baseUrl, login.data.token), admin.email);
    console.log(`Criados: ${summary.created} | já existiam: ${summary.existing} | ignorados (admin do .env): ${summary.skipped}`);
    for (const failure of summary.failed) console.log(`  falhou ${failure.email}: ${failure.reason}`);
    if (summary.failed.length) process.exitCode = 1;
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`Erro: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { parseCsv, seedUsers };
