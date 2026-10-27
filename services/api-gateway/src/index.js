// Inicializa o gateway HTTP e mantém a porta configurável por ambiente.
const app = require('./app');
const config = require('./config/env');

app.listen(config.port, () => {
    console.log(`api-gateway escutando na porta ${config.port}`);
});
