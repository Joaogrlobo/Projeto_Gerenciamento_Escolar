const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// tenta várias vezes: o banco pode demorar a subir
async function init(sql, tentativas = 10) {
    for (let i = 1; i <= tentativas; i++) {
        try { await pool.query(sql); return; }
        catch (e) {
            console.log(`Aguardando banco (${i}/${tentativas}): ${e.message}`);
            await new Promise(r => setTimeout(r, 3000));
        }
    }
    throw new Error('Banco indisponível');
}
module.exports = { pool, init };