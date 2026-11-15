// Configuração do serviço de funcionários a partir do ambiente.
// CORS_ORIGIN: lista separada por vírgula, ou "*". Vazio desativa o CORS do serviço,
// que hoje é acessado pelo navegador apenas através do gateway.
function parseOrigins(value) {
    const origins = (value || '').split(',').map(origin => origin.trim()).filter(Boolean);
    if (origins.includes('*')) return '*';
    return origins.length ? origins : false;
}

module.exports = {
    port: process.env.PORT || 3003,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    corsOrigin: parseOrigins(process.env.CORS_ORIGIN),
    rabbitmqUrl: process.env.RABBITMQ_URL
};
