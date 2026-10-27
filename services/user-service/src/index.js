// Ponto de entrada: inicializa banco, seed e servidor HTTP.
const app = require('./app');
const config = require('./config/env');
const { init } = require('./config/db');
const schema = require('./database/schema');
const seedAdmin = require('./services/seed.service');
const { connect } = require('./messaging/rabbit');

connect();

init(schema).then(seedAdmin).then(() => {
    app.listen(config.port, () => console.log(`user-service na porta ${config.port}`));
});