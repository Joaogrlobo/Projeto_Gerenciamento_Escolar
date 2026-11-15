// Ponto de entrada: inicializa banco e servidor HTTP.
const app = require('./app');
const config = require('./config/env');
const { init, pool } = require('./config/db');
const schema = require('./database/schema');
const { connect, publish } = require('./messaging/rabbit');
const { createRelay } = require('./messaging/relay');

connect();
init(schema).then(() => {
    createRelay({ pool, publish }).start();
    app.listen(config.port, () => console.log(`student-service na porta ${config.port}`));
});