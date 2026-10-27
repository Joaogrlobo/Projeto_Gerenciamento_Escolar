// Configuração do serviço de usuários a partir do ambiente.
module.exports = {
    port: process.env.PORT || 3001,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    adminEmail: process.env.ADMIN_EMAIL,
    adminPassword: process.env.ADMIN_PASSWORD,
    rabbitmqUrl: process.env.RABBITMQ_URL
};
