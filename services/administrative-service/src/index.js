const app = require('./app');
const config = require('./config/env');
const { init } = require('./config/db');
const schema = require('./database/schema');
const { connect } = require('./messaging/rabbit');

connect();
init(schema).then(() => {
    app.listen(config.port, () => console.log(`administrative-service na porta ${config.port}`));
}).catch(error => {
    console.error('Falha ao inicializar administrative-service:', error.message);
    process.exitCode = 1;
});
