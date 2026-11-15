// Configuração do serviço de usuários a partir do ambiente.
// CORS_ORIGIN: lista separada por vírgula, ou "*". Vazio desativa o CORS do serviço,
// que hoje é acessado pelo navegador apenas através do gateway.
function parseOrigins(value) {
    const origins = (value || '').split(',').map(origin => origin.trim()).filter(Boolean);
    if (origins.includes('*')) return '*';
    return origins.length ? origins : false;
}

module.exports = {
    port: process.env.PORT || 3001,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    corsOrigin: parseOrigins(process.env.CORS_ORIGIN),
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
    rabbitmqUrl: process.env.RABBITMQ_URL
};
