// Configuração do serviço de funcionários a partir do ambiente.
module.exports = {
    port: process.env.PORT || 3003,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    rabbitmqUrl: process.env.RABBITMQ_URL
};
