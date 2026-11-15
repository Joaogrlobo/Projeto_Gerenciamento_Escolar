// Pool PostgreSQL e inicialização de esquema com retry.
const { Pool } = require('pg');
const config = require('./env');

const pool = new Pool({ connectionString: config.databaseUrl });
pool.on('error', error => console.error('Erro inesperado no pool PostgreSQL:', error.message));

async function init(sql, attempts = 10) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await pool.query(sql);
            return;
        } catch (error) {
            console.log(`Aguardando banco (${attempt}/${attempts}): ${error.message}`);
            if (attempt === attempts) break;
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    throw new Error('Banco indisponível após tentativas de conexão');
}

module.exports = { pool, init };
