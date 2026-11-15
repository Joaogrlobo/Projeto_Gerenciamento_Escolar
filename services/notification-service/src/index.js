// Inicializa o esquema, o consumidor, o WebSocket e o servidor HTTP.
const app = require('./app');
const config = require('./config/env');
const { init } = require('./config/db');
const schema = require('./database/schema');
const { connect } = require('./messaging/rabbit');
const { createHub } = require('./realtime/hub');

async function start() {
    await init(schema);
    const hub = createHub({ jwtSecret: config.jwtSecret });
    const server = app.listen(config.port, () => {
        console.log(`notification-service iniciado na porta ${config.port}`);
    });
    hub.attach(server);
    connect({ onLive: hub.broadcast });
}

start().catch(() => {
    console.error('Falha ao inicializar notification-service');
    process.exitCode = 1;
});
