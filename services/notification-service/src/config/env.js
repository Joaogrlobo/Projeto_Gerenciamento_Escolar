// Configuração do serviço de notificações a partir do ambiente.
module.exports = {
    port: process.env.PORT || 3006,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    rabbitmqUrl: process.env.RABBITMQ_URL
};
