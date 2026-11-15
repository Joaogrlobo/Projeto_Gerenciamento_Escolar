const app = require('./app');
const config = require('./config/env');
const { init, pool } = require('./config/db');
const schema = require('./database/schema');
const { connect, publish } = require('./messaging/rabbit');
const { createRelay } = require('./messaging/relay');

connect();
init(schema).then(() => {
    createRelay({ pool, publish }).start();
    app.listen(config.port, () => console.log(`administrative-service na porta ${config.port}`));
}).catch(error => {
    console.error('Falha ao inicializar administrative-service:', error.message);
    process.exitCode = 1;
});
