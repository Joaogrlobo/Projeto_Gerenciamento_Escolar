const { Pool } = require('pg');
const config = require('./env');

const pool = new Pool({ connectionString: config.databaseUrl });

async function init(sql, attempts = 10) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await pool.query(sql);
            return;
        } catch (error) {
            if (attempt === attempts) break;
            console.error(`Aguardando banco (${attempt}/${attempts}): ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }
    throw new Error('Banco indisponível');
}

module.exports = { pool, init };
