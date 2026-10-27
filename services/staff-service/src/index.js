// Ponto de entrada: inicializa banco e servidor HTTP.
const app = require('./app');
const config = require('./config/env');
const { init } = require('./config/db');
const schema = require('./database/schema');
const { connect } = require('./messaging/rabbit');

connect();
init(schema).then(() => {
    app.listen(config.port, () => console.log(`staff-service na porta ${config.port}`));
});