// Pool PostgreSQL e inicialização de esquema com tentativas limitadas.
const { Pool } = require('pg');
const config = require('./env');

const pool = new Pool({ connectionString: config.databaseUrl });
pool.on('error', error => console.error('Erro inesperado no pool PostgreSQL:', error.message));

async function init(sql, attempts = 10, delayMs = 3000) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await pool.query(sql);
            return;
        } catch (error) {
            console.error(`Aguardando banco (${attempt}/${attempts}): ${error.message}`);
            if (attempt < attempts) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }
    throw new Error('Banco indisponível');
}

async function withTransaction(operation) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // Uma conexão perdida já descarta a transação.
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { pool, init, withTransaction };
