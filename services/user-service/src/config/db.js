// Pool PostgreSQL e inicialização de esquema com retry.
const { Pool } = require('pg');
const config = require('./env');

const pool = new Pool({ connectionString: config.databaseUrl });

async function init(sql, tentativas = 10) {
    for (let i = 1; i <= tentativas; i++) {
        try {
            await pool.query(sql);
            return;
        } catch (error) {
            console.log(`Aguardando banco (${i}/${tentativas}): ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 3000));
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
