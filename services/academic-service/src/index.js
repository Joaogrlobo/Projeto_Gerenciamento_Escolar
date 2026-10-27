// Inicializa o esquema acadêmico, inicia mensageria e escuta na porta configurada.
const app = require('./app');
const config = require('./config/env');
const { init, pool } = require('./config/db');
const schema = require('./database/schema');
const { connect } = require('./messaging/rabbit');

async function start() {
    await init(schema);
    connect();
    const server = app.listen(config.port, () => {
        console.log(`academic-service na porta ${config.port}`);
    });

    const shutdown = () => {
        server.close(async () => {
            await pool.end();
            process.exit(0);
        });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

start().catch(async error => {
    console.error('Falha ao iniciar academic-service:', error.message);
    await pool.end();
    process.exitCode = 1;
});
