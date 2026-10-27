// Centraliza as configurações do gateway e os endereços dos serviços internos.
const serviceUrl = (name, fallback) => (process.env[name] || fallback).replace(/\/+$/, '');

module.exports = {
    port: Number(process.env.PORT) || 8080,
    jwtSecret: process.env.JWT_SECRET,
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    loginRateLimit: Math.max(1, Number.parseInt(process.env.LOGIN_RATE_LIMIT, 10) || 20),
    serviceHealthTimeoutMs: 1500,
    services: {
        'user-service': serviceUrl('USER_SERVICE_URL', 'http://user-service:3001'),
        'student-service': serviceUrl('STUDENT_SERVICE_URL', 'http://student-service:3002'),
        'staff-service': serviceUrl('STAFF_SERVICE_URL', 'http://staff-service:3003'),
        'academic-service': serviceUrl('ACADEMIC_SERVICE_URL', 'http://academic-service:3004'),
        'administrative-service': serviceUrl('ADMINISTRATIVE_SERVICE_URL', 'http://administrative-service:3005'),
        'notification-service': serviceUrl('NOTIFICATION_SERVICE_URL', 'http://notification-service:3006')
    }
};
