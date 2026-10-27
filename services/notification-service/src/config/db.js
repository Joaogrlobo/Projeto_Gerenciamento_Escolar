// Pool PostgreSQL e inicialização de esquema com retry.
const { Pool } = require('pg');
const config = require('./env');

const pool = new Pool({ connectionString: config.databaseUrl });

async function init(sql, attempts = 10) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await pool.query(sql);
            return;
        } catch {
            if (attempt === attempts) break;
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    throw new Error('Banco indisponível após tentativas de conexão');
}

module.exports = { pool, init };
