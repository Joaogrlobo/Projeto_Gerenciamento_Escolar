module.exports = {
    port: Number(process.env.PORT) || 3004,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    rabbitmqUrl: process.env.RABBITMQ_URL,
    staffServiceUrl: (process.env.STAFF_SERVICE_URL || 'http://staff-service:3003').replace(/\/+$/, '')
};
