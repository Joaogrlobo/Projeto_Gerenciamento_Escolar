// Ponto de entrada: inicializa banco, seed e servidor HTTP.
const app = require('./app');
const config = require('./config/env');
const { init, pool } = require('./config/db');
const schema = require('./database/schema');
const seedAdmin = require('./services/seed.service');
const { connect, publish } = require('./messaging/rabbit');
const { createRelay } = require('./messaging/relay');

connect();

init(schema).then(seedAdmin).then(() => {
    createRelay({ pool, publish }).start();
    app.listen(config.port, () => console.log(`user-service na porta ${config.port}`));
});