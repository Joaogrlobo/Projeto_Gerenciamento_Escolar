// Configuração do serviço acadêmico derivada exclusivamente do ambiente.
module.exports = {
    port: Number(process.env.PORT || 3004),
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    studentServiceUrl: process.env.STUDENT_SERVICE_URL,
    administrativeServiceUrl: process.env.ADMINISTRATIVE_SERVICE_URL,
    rabbitmqUrl: process.env.RABBITMQ_URL
};
