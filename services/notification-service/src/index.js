// Inicializa o esquema, o consumidor e o servidor HTTP.
const app = require('./app');
const config = require('./config/env');
const { init } = require('./config/db');
const schema = require('./database/schema');
const { connect } = require('./messaging/rabbit');

async function start() {
    await init(schema);
    app.listen(config.port, () => {
        console.log(`notification-service iniciado na porta ${config.port}`);
    });
    connect();
}

start().catch(() => {
    console.error('Falha ao inicializar notification-service');
    process.exitCode = 1;
});
